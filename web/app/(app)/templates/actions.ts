"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decrypt, prisma, type Prisma } from "@ll/db";
import { graphGet, graphPost, GraphError, resumableUpload } from "@ll/db/src/graph";
import { toComponents, validateDraft, type Draft } from "@ll/db/src/templates";
import { audit } from "@/lib/audit";
import { requireCan } from "@/lib/session";
import { act, str, type ActionState } from "@/lib/server";

const TEST = "This is a test account, not connected to Meta, so it cannot sync or submit templates.";
const explain = (e: unknown) => (e instanceof GraphError ? new Error(`Meta: ${e.message}${e.code ? ` (code ${e.code})` : ""}`) : e);

async function waba(orgId: string, id: string) {
  const w = await prisma.waba.findFirst({ where: { id, orgId } });
  if (!w) throw new Error("Account not found.");
  return w;
}

type MetaTemplate = { id: string; name: string; language: string; category: string; status: string; rejected_reason?: string; quality_score?: { score?: string }; components?: unknown[] };

/** GET /{waba-id}/message_templates, all pages. Records a version whenever Meta's components change. */
export async function syncTemplates(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("templates.write");
    const w = await waba(m.orgId, str(f, "wabaId"));
    if (w.isFixture) throw new Error(TEST);
    const token = decrypt(w.accessTokenEnc);
    let after: string | undefined;
    let n = 0;
    try {
      do {
        const page = await graphGet<{ data: MetaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${w.metaWabaId}/message_templates`, token,
          { fields: "id,name,language,category,status,rejected_reason,quality_score,components", limit: "100", ...(after ? { after } : {}) });
        for (const t of page.data) {
          const existing = await prisma.template.findUnique({ where: { wabaId_metaTemplateId: { wabaId: w.id, metaTemplateId: t.id } } });
          const changed = !existing || JSON.stringify(existing.components) !== JSON.stringify(t.components ?? []);
          const data = { name: t.name, language: t.language, category: t.category, status: t.status, reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null, quality: t.quality_score?.score ?? null, components: (t.components ?? []) as Prisma.InputJsonArray, syncedAt: new Date() };
          const row = existing
            ? await prisma.template.update({ where: { id: existing.id }, data: { ...data, ...(changed ? { version: { increment: 1 } } : {}) } })
            : await prisma.template.create({ data: { wabaId: w.id, metaTemplateId: t.id, ...data } });
          if (changed) await prisma.templateVersion.create({ data: { templateId: row.id, version: row.version, category: t.category, language: t.language, components: data.components, note: "Synced from Meta" } });
          n++;
        }
        after = page.paging?.next ? page.paging.cursors?.after : undefined;
      } while (after);
    } catch (e) { throw explain(e); }
    await audit(m, "template.sync", w.metaWabaId, { templates: n });
    revalidatePath("/templates");
    return `Synced ${n} template${n === 1 ? "" : "s"} from Meta.`;
  });
}

function readDraft(f: FormData): Draft {
  try { return JSON.parse(str(f, "draft")) as Draft; } catch { throw new Error("The template form could not be read."); }
}

export async function saveDraft(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const m = await requireCan("templates.write");
    const d = readDraft(f);
    const errors = validateDraft(d).filter((e) => !e.startsWith("Media header")); // the sample file can come later
    if (errors.length) throw new Error(errors.join(" "));
    const w = await waba(m.orgId, str(f, "wabaId"));
    const components = toComponents(d) as unknown as Prisma.InputJsonArray;
    const id = str(f, "id");
    let t;
    if (id) {
      const cur = await prisma.template.findFirst({ where: { id, waba: { orgId: m.orgId } } });
      if (!cur) throw new Error("Template not found.");
      if (cur.metaTemplateId) throw new Error("This template is already at Meta. Duplicate it to make changes.");
      t = await prisma.template.update({ where: { id }, data: { name: d.name, language: d.language, category: d.category, components, version: { increment: 1 } } });
    } else {
      t = await prisma.template.create({ data: { wabaId: w.id, name: d.name, language: d.language, category: d.category, status: "DRAFT", components } });
    }
    await prisma.templateVersion.create({ data: { templateId: t.id, version: t.version, category: d.category, language: d.language, components, note: "Saved draft", createdById: m.userId } });
    await audit(m, "template.save_draft", t.id, { name: d.name, version: t.version });
    return { ok: "Draft saved.", data: { id: t.id } };
  });
  if (r.error) return r;
  revalidatePath("/templates");
  redirect(`/templates/${r.data!.id}`);
}

/** POST /{waba-id}/message_templates. Needs your approval: it sends the template to Meta for review. */
export async function submitTemplate(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("templates.write");
    const t = await prisma.template.findFirst({ where: { id: str(f, "id"), waba: { orgId: m.orgId } }, include: { waba: true } });
    if (!t) throw new Error("Template not found.");
    if (t.metaTemplateId) throw new Error("Already submitted.");
    if (t.waba.isFixture) throw new Error(TEST);
    const { fromComponents } = await import("@ll/db/src/templates");
    const errors = validateDraft(fromComponents(t.name, t.language ?? "en", t.category ?? "", t.components));
    if (errors.length) throw new Error(errors.join(" "));
    let r;
    try {
      r = await graphPost<{ id: string; status: string; category: string }>(`${t.waba.metaWabaId}/message_templates`, decrypt(t.waba.accessTokenEnc),
        { name: t.name, language: t.language, category: t.category, components: t.components });
    } catch (e) { throw explain(e); }
    const u = await prisma.template.update({ where: { id: t.id }, data: { metaTemplateId: r.id, status: r.status, category: r.category ?? t.category, submittedAt: new Date(), version: { increment: 1 } } });
    await prisma.templateVersion.create({ data: { templateId: t.id, version: u.version, category: u.category, language: u.language, components: t.components ?? [], note: `Submitted to Meta (${r.status})`, createdById: m.userId } });
    await audit(m, "template.submit", t.id, { name: t.name, metaId: r.id, status: r.status });
    revalidatePath("/templates");
    revalidatePath(`/templates/${t.id}`);
    return `Submitted. Meta says: ${r.status.toLowerCase()}. Status changes arrive by webhook.`;
  });
}

export async function duplicateTemplate(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const m = await requireCan("templates.write");
    const t = await prisma.template.findFirst({ where: { id: str(f, "id"), waba: { orgId: m.orgId } } });
    if (!t) throw new Error("Template not found.");
    const base = `${t.name.slice(0, 500)}_copy`;
    let name = base;
    for (let i = 2; await prisma.template.findFirst({ where: { wabaId: t.wabaId, name } }); i++) name = `${base}${i}`;
    const copy = await prisma.template.create({ data: { wabaId: t.wabaId, name, language: t.language, category: t.category, status: "DRAFT", components: t.components ?? [] } });
    await prisma.templateVersion.create({ data: { templateId: copy.id, version: 1, category: t.category, language: t.language, components: t.components ?? [], note: `Duplicated from ${t.name}`, createdById: m.userId } });
    await audit(m, "template.duplicate", copy.id, { from: t.id });
    return { data: { id: copy.id } };
  });
  if (r.error) return r;
  redirect(`/templates/${r.data!.id}/edit`);
}

export async function deleteDraft(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const m = await requireCan("templates.write");
    const t = await prisma.template.findFirst({ where: { id: str(f, "id"), waba: { orgId: m.orgId } } });
    if (!t) throw new Error("Template not found.");
    if (t.metaTemplateId) throw new Error("Templates at Meta are deleted in WhatsApp Manager; this only deletes drafts.");
    await prisma.template.delete({ where: { id: t.id } });
    await audit(m, "template.delete_draft", t.id, { name: t.name });
  });
  if (r.error) return r;
  revalidatePath("/templates");
  redirect("/templates");
}

/** Media header samples go through Meta's Resumable Upload API and come back as a handle. */
export async function uploadHeaderSample(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("templates.write");
    const w = await waba(m.orgId, str(f, "wabaId"));
    if (w.isFixture) throw new Error(TEST);
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Choose a file.");
    if (file.size > 16e6) throw new Error("Sample files are at most 16 MB.");
    try {
      const handle = await resumableUpload(decrypt(w.accessTokenEnc), new Uint8Array(await file.arrayBuffer()), file.type, file.name);
      await audit(m, "template.upload_sample", w.metaWabaId);
      return { ok: "Sample uploaded to Meta.", data: { handle } };
    } catch (e) { throw explain(e); }
  });
}

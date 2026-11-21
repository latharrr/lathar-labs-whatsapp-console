"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, type Prisma } from "@ll/db";
import { deleteContactData, importContacts, normalizePhone, parseCsv } from "@ll/db/src/contacts";
import { applyOptIn, applyOptOut } from "@ll/db/src/optout";
import { FIELDS, segmentWhere, type Rules } from "@ll/db/src/segments";
import { audit } from "@/lib/audit";
import { requireCan } from "@/lib/session";
import { act, str, type ActionState } from "@/lib/server";

async function own(orgId: string, id: string) {
  const c = await prisma.contact.findFirst({ where: { id, orgId } });
  if (!c) throw new Error("Contact not found.");
  return c;
}
const done = (id?: string) => { revalidatePath("/contacts"); if (id) revalidatePath(`/contacts/${id}`); revalidatePath("/inbox", "layout"); };

export async function createContact(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.write");
    const waId = normalizePhone(str(f, "phone"));
    if (!waId) throw new Error("Enter the number in international format, like +91 98765 43210.");
    const c = await prisma.contact.create({ data: { orgId: m.orgId, waId, name: str(f, "name") || null } });
    await audit(m, "contact.create", c.id);
    done();
    return { ok: "Contact added.", data: { id: c.id } };
  });
}

export async function updateContact(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.write");
    const c = await own(m.orgId, str(f, "id"));
    const email = str(f, "email");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That email address does not look right.");
    await prisma.contact.update({ where: { id: c.id }, data: { name: str(f, "name") || null, email: email || null } });
    await audit(m, "contact.update", c.id);
    done(c.id);
    return "Saved.";
  });
}

export async function setAttribute(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.write");
    const c = await own(m.orgId, str(f, "id"));
    const key = str(f, "key").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
    const value = str(f, "value").slice(0, 500);
    if (!key) throw new Error("Give the attribute a name.");
    if (!value) await prisma.contactAttribute.deleteMany({ where: { contactId: c.id, key } });
    else await prisma.contactAttribute.upsert({ where: { contactId_key: { contactId: c.id, key } }, create: { contactId: c.id, key, value }, update: { value } });
    await audit(m, value ? "contact.attribute_set" : "contact.attribute_delete", c.id, { key });
    done(c.id);
    return value ? "Attribute saved." : "Attribute removed.";
  });
}

export async function recordOptIn(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.write");
    const c = await own(m.orgId, str(f, "id"));
    const source = str(f, "source");
    const proof = str(f, "proof");
    if (!source || !proof) throw new Error("Record where the consent came from and the proof (a form link, message id or document).");
    await applyOptIn(prisma, { orgId: m.orgId, contactId: c.id, source, proof, userId: m.userId });
    done(c.id);
    return "Marketing opt-in recorded.";
  });
}

export async function recordOptOut(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.write");
    const c = await own(m.orgId, str(f, "id"));
    const r = await applyOptOut(prisma, { orgId: m.orgId, contactId: c.id, source: `manual by ${m.email}` });
    done(c.id);
    return `Opted out.${r.cancelled ? ` ${r.cancelled} queued message${r.cancelled === 1 ? "" : "s"} cancelled.` : ""}`;
  });
}

export async function toggleBlock(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.write");
    const c = await own(m.orgId, str(f, "id"));
    const blocked = !c.blocked;
    await prisma.contact.update({ where: { id: c.id }, data: { blocked, blockedAt: blocked ? new Date() : null } });
    if (blocked) await prisma.outboundMessage.updateMany({ where: { orgId: m.orgId, contactId: c.id, status: "queued" }, data: { status: "cancelled", errorMessage: "Contact blocked" } });
    await audit(m, blocked ? "contact.block" : "contact.unblock", c.id);
    done(c.id);
    return blocked ? "Blocked. Nothing will be sent to this contact." : "Unblocked.";
  });
}

export async function eraseContact(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const m = await requireCan("contacts.delete");
    const c = await own(m.orgId, str(f, "id"));
    const res = await deleteContactData(prisma, m.orgId, c.id);
    await audit(m, "contact.erase_request", c.id, res ?? {});
    done();
  });
  if (r.error) return r;
  redirect("/contacts?erased=1");
}

export async function runImport(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.import");
    const csv = str(f, "csv");
    if (!csv) throw new Error("Choose a CSV file first.");
    if (csv.length > 5_000_000) throw new Error("That file is over 5 MB. Split it into smaller files.");
    const rows = parseCsv(csv);
    if (rows.length > 20_001) throw new Error("At most 20,000 rows per import.");
    const consent = f.get("consent") === "on";
    const source = str(f, "source");
    const proof = str(f, "proof");
    if (consent && (!source || !proof)) throw new Error("To import opt-ins, say where consent came from and give the proof.");
    const r = await importContacts(prisma, m.orgId, rows, {
      phoneColumn: str(f, "phoneColumn"), nameColumn: str(f, "nameColumn") || undefined, emailColumn: str(f, "emailColumn") || undefined,
      attributeColumns: f.getAll("attr").map(String), tag: str(f, "tag") || undefined, optIn: consent ? { source, proof } : undefined, userId: m.userId,
    });
    await audit(m, "contact.import", undefined, { created: r.created, updated: r.updated, duplicates: r.duplicates, invalid: r.invalid.length, optIn: consent });
    done();
    return { ok: `Imported: ${r.created} new, ${r.updated} updated, ${r.duplicates} duplicates skipped, ${r.invalid.length} invalid.`, data: { invalid: r.invalid.slice(0, 50) } };
  });
}

function parseRules(f: FormData): Rules {
  const fields = f.getAll("field").map(String), ops = f.getAll("op").map(String), values = f.getAll("value").map(String);
  const known = new Set<string>(FIELDS.map((x) => x.field));
  const conditions = fields.map((field, i) => ({ field, op: ops[i], value: values[i] })).filter((c) => c.field && known.has(c.field));
  return { match: str(f, "match") === "any" ? "any" : "all", conditions };
}

export async function previewSegment(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.read");
    const where = segmentWhere(m.orgId, parseRules(f));
    const [count, eligible] = await Promise.all([prisma.contact.count({ where }), prisma.contact.count({ where: { AND: [where, { optInStatus: "opted_in", blocked: false }] } })]);
    return { ok: `${count} contacts match, ${eligible} can receive marketing.` };
  });
}

export async function saveSegment(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.write");
    const name = str(f, "name").slice(0, 80);
    if (!name) throw new Error("Name the segment.");
    const rules = parseRules(f);
    segmentWhere(m.orgId, rules); // validates
    const id = str(f, "segmentId");
    if (id) {
      const s = await prisma.segment.findFirst({ where: { id, orgId: m.orgId } });
      if (!s) throw new Error("Segment not found.");
      await prisma.segment.update({ where: { id }, data: { name, rules: rules as unknown as Prisma.InputJsonObject } });
    } else await prisma.segment.create({ data: { orgId: m.orgId, name, rules: rules as unknown as Prisma.InputJsonObject } });
    await audit(m, id ? "segment.update" : "segment.create", name);
    revalidatePath("/contacts/segments");
    return "Segment saved.";
  });
}

export async function deleteSegment(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.write");
    const r = await prisma.segment.deleteMany({ where: { id: str(f, "id"), orgId: m.orgId } });
    if (!r.count) throw new Error("Segment not found.");
    await audit(m, "segment.delete", str(f, "id"));
    revalidatePath("/contacts/segments");
    return "Segment deleted.";
  });
}

export async function saveField(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("settings.manage");
    const key = str(f, "key").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
    const type = ["text", "number", "date", "boolean"].includes(str(f, "type")) ? str(f, "type") : "text";
    if (!key || !str(f, "label")) throw new Error("Give the field a key and a label.");
    await prisma.customField.upsert({ where: { orgId_key: { orgId: m.orgId, key } }, create: { orgId: m.orgId, key, label: str(f, "label"), type }, update: { label: str(f, "label"), type } });
    await audit(m, "field.save", key);
    revalidatePath("/contacts/fields");
    return "Field saved.";
  });
}

export async function deleteField(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("settings.manage");
    await prisma.customField.deleteMany({ where: { id: str(f, "id"), orgId: m.orgId } });
    await audit(m, "field.delete", str(f, "id"));
    revalidatePath("/contacts/fields");
    return "Field removed. Values already stored on contacts are kept.";
  });
}

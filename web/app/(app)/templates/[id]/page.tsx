import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, templateReason } from "@ll/db";
import { can } from "@ll/db/src/permissions";
import { fromComponents } from "@ll/db/src/templates";
import { ConfirmForm } from "@/components/action-form";
import { buttonClass } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { PageHeader, StatusChip } from "@/components/ui/kit";
import { quality } from "@/lib/format";
import { requirePage } from "@/lib/session";
import { deleteDraft, duplicateTemplate, submitTemplate } from "../actions";
import { PhonePreview } from "../builder";

export const metadata = { title: "Template" };
export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: { id: string } }) {
  const m = await requirePage("inbox.read");
  const t = await prisma.template.findFirst({ where: { id: params.id, waba: { orgId: m.orgId } }, include: { waba: true, versions: { orderBy: { version: "desc" } } } });
  if (!t) notFound();
  const d = fromComponents(t.name, t.language ?? "en", t.category ?? "MARKETING", t.components);
  const manage = can(m.role, "templates.write");
  const q = quality(t.quality);
  const draft = !t.metaTemplateId;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.name} subtitle={<>{(t.category ?? "").toLowerCase()} · {t.language} · {t.waba.name ?? t.waba.metaWabaId}</>}
        actions={manage ? <>
          {draft && <Link href={`/templates/${t.id}/edit`} className={buttonClass("secondary")}>Edit draft</Link>}
          <ConfirmForm action={duplicateTemplate} hidden={{ id: t.id }} label="Duplicate" title={`Duplicate ${t.name}?`} body="Creates a new draft with the same content, for edits or a new language." confirm="Duplicate" />
          {draft && (t.waba.isFixture
            ? <Chip tone="warn">Test account: cannot submit to Meta</Chip>
            : <ConfirmForm action={submitTemplate} hidden={{ id: t.id }} variant="primary" label="Submit to Meta" title="Submit this template for review?" body="Meta reviews it, usually within minutes, sometimes up to 24 hours. The result arrives by webhook. Edits after submitting need a new draft." confirm="Submit" />)}
          {draft && <ConfirmForm action={deleteDraft} hidden={{ id: t.id }} variant="danger" tone="danger" label="Delete draft" title="Delete this draft?" body="This cannot be undone. Versions are deleted with it." confirm="Delete" />}
        </> : undefined} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle aside={<StatusChip status={t.status} />}>Status</CardTitle>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted">Quality</dt><dd className="mt-0.5"><Chip tone={q.tone}>{q.label}</Chip></dd></div>
              <div><dt className="text-xs text-muted">Meta template id</dt><dd className="mt-0.5 font-mono text-[13px]">{t.metaTemplateId ?? "Not submitted"}</dd></div>
              {t.reason && <div className="sm:col-span-2"><dt className="text-xs text-muted">Why Meta {t.status === "REJECTED" ? "rejected" : "flagged"} it</dt><dd className="mt-0.5">{templateReason(t.reason)}</dd></div>}
            </dl>
          </Card>
          <Card>
            <CardTitle>Version history</CardTitle>
            {t.versions.length === 0 ? <p className="text-sm text-muted">No versions recorded.</p> : (
              <ol className="flex flex-col gap-2 text-sm">{t.versions.map((v) => (
                <li key={v.id} className="border-b border-line pb-2">
                  <span className="font-medium">Version {v.version}</span> · {v.note} · <span className="text-muted">{v.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
                  <details className="mt-1"><summary className="cursor-pointer text-xs text-muted">Components</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-control bg-surface p-2 font-mono text-xs">{JSON.stringify(v.components, null, 1)}</pre></details>
                </li>
              ))}</ol>
            )}
          </Card>
        </div>
        <PhonePreview d={d} />
      </div>
    </div>
  );
}

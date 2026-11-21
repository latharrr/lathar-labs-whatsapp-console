import Link from "next/link";
import { prisma } from "@ll/db";
import { can } from "@ll/db/src/permissions";
import { templateReason } from "@ll/db";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Empty, PageHeader, Select, StatusChip, td, th } from "@/components/ui/kit";
import { ago, quality } from "@/lib/format";
import { requirePage } from "@/lib/session";
import { syncTemplates } from "./actions";

export const metadata = { title: "Templates" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage({ searchParams: sp }: { searchParams: { status?: string; category?: string } }) {
  const m = await requirePage("inbox.read");
  const wabas = await prisma.waba.findMany({ where: { orgId: m.orgId }, orderBy: { createdAt: "asc" } });
  const rows = await prisma.template.findMany({
    where: { waba: { orgId: m.orgId }, ...(sp.status ? { status: sp.status } : {}), ...(sp.category ? { category: sp.category } : {}) },
    include: { waba: { select: { name: true, isFixture: true } } }, orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  const manage = can(m.role, "templates.write");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Templates" subtitle="Templates are needed to message people who have not written in the last 24 hours, and for campaigns."
        actions={manage && wabas.length > 0 ? <Link href="/templates/new" className={buttonClass("primary")}>New template</Link> : undefined} />
      {manage && wabas.length > 0 && (
        <Card className="flex flex-wrap items-center gap-3">
          {wabas.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{w.name ?? w.metaWabaId}</span>
              {w.isFixture ? <Chip tone="warn">Test account, not connected to Meta</Chip> : (
                <ActionForm action={syncTemplates}><input type="hidden" name="wabaId" value={w.id} /><SubmitButton variant="secondary" pending="Syncing…">Sync from Meta</SubmitButton></ActionForm>
              )}
            </div>
          ))}
        </Card>
      )}
      <form className="flex flex-wrap gap-2" action="/templates">
        <label htmlFor="ts" className="sr-only">Status</label>
        <Select id="ts" name="status" defaultValue={sp.status ?? ""} className="h-9 w-auto"><option value="">Any status</option>{["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED", "DRAFT"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select>
        <label htmlFor="tcat" className="sr-only">Category</label>
        <Select id="tcat" name="category" defaultValue={sp.category ?? ""} className="h-9 w-auto"><option value="">Any category</option>{["MARKETING", "UTILITY", "AUTHENTICATION"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select>
        <button className={buttonClass("secondary")}>Filter</button>
      </form>
      {rows.length === 0 ? (
        <Empty title={wabas.length ? "No templates here" : "No account connected"} body={wabas.length ? "Sync from Meta to list your approved templates, or create a draft." : "Connect a WhatsApp Business Account in Settings first."}
          action={!wabas.length && can(m.role, "settings.manage") ? <Link href="/settings" className={buttonClass("primary")}>Connect an account</Link> : undefined} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className={th}>Name</th><th className={th}>Status</th><th className={`${th} hidden sm:table-cell`}>Category</th><th className={`${th} hidden sm:table-cell`}>Language</th><th className={`${th} hidden md:table-cell`}>Quality</th><th className={`${th} hidden lg:table-cell`}>Updated</th></tr></thead>
            <tbody>{rows.map((t) => {
              const q = quality(t.quality);
              return (
                <tr key={t.id}>
                  <td className={td}><Link href={`/templates/${t.id}`} className="font-medium underline-offset-2 hover:underline">{t.name}</Link>{t.waba.isFixture && <span className="ml-1 text-xs text-muted">(test)</span>}
                    {t.reason && <span className="block text-xs text-muted">{templateReason(t.reason)}</span>}</td>
                  <td className={td}><StatusChip status={t.status} /></td>
                  <td className={`${td} hidden capitalize sm:table-cell`}>{(t.category ?? "").toLowerCase()}</td>
                  <td className={`${td} hidden sm:table-cell`}>{t.language}</td>
                  <td className={`${td} hidden md:table-cell`}><Chip tone={q.tone}>{q.label}</Chip></td>
                  <td className={`${td} hidden text-muted lg:table-cell`}>{ago(t.updatedAt)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

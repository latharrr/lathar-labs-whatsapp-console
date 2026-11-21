import Link from "next/link";
import { prisma, type Prisma } from "@ll/db";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader, Select, StatusChip, td, th } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";

export const metadata = { title: "Event log" };
export const dynamic = "force-dynamic";

export default async function EventsPage({ searchParams: sp }: { searchParams: { status?: string; field?: string; before?: string } }) {
  const m = await requirePage("developer.manage");
  const where: Prisma.WebhookEventWhereInput = {
    orgId: m.orgId,
    ...(sp.field ? { field: sp.field } : {}),
    ...(sp.status === "failed" ? { processedAt: null, attempts: { gt: 0 } } : sp.status === "pending" ? { processedAt: null, attempts: 0 } : sp.status === "done" ? { processedAt: { not: null } } : {}),
    ...(sp.before ? { receivedAt: { lt: new Date(sp.before) } } : {}),
  };
  const [rows, fields] = await Promise.all([
    prisma.webhookEvent.findMany({ where, orderBy: { receivedAt: "desc" }, take: 50, select: { id: true, field: true, receivedAt: true, processedAt: true, attempts: true, lastError: true, note: true } }),
    prisma.webhookEvent.findMany({ where: { orgId: m.orgId }, distinct: ["field"], select: { field: true } }),
  ]);
  return (
    <>
      <PageHeader title="Webhook event log" subtitle="Every signed event Meta sent for this workspace's accounts, stored before it was acknowledged." />
      <form className="flex flex-wrap gap-2" action="/developer/events">
        <label htmlFor="es" className="sr-only">Status</label>
        <Select id="es" name="status" defaultValue={sp.status ?? ""} className="h-9 w-auto"><option value="">Any status</option><option value="done">Processed</option><option value="pending">Waiting</option><option value="failed">Failing</option></Select>
        <label htmlFor="ef" className="sr-only">Field</label>
        <Select id="ef" name="field" defaultValue={sp.field ?? ""} className="h-9 w-auto"><option value="">Any field</option>{fields.filter((f) => f.field).map((f) => <option key={f.field!}>{f.field}</option>)}</Select>
        <button className={buttonClass("secondary")}>Filter</button>
      </form>
      {rows.length === 0 ? <Empty title="No events" body="Events appear here when Meta delivers webhooks for your connected accounts. Test fixtures are labelled." /> : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Received</th><th className={th}>Field</th><th className={th}>Status</th><th className={`${th} hidden md:table-cell`}>Note</th></tr></thead>
            <tbody>{rows.map((e) => <tr key={e.id}><td className={`${td} tnum sm:whitespace-nowrap`}><Link href={`/developer/events/${e.id}`} className="underline">{e.receivedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</Link></td><td className={`${td} break-all font-mono text-[13px]`}>{e.field ?? "-"}</td>
              <td className={td}><StatusChip status={e.processedAt ? "ok" : e.attempts ? "failed" : "pending"} />{e.lastError && <span className="block text-xs text-muted">{e.lastError.slice(0, 120)}</span>}</td><td className={`${td} hidden text-muted md:table-cell`}>{e.note}</td></tr>)}</tbody></table>
          {rows.length === 50 && <Link href={`/developer/events?${new URLSearchParams({ ...(sp.status ? { status: sp.status } : {}), ...(sp.field ? { field: sp.field } : {}), before: rows[49].receivedAt.toISOString() })}`} className={buttonClass("secondary", "mt-3")}>Older</Link>}
        </Card>
      )}
    </>
  );
}

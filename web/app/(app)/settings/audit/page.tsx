import Link from "next/link";
import { prisma, type Prisma } from "@ll/db";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader, Select, td, th } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams: sp }: { searchParams: { action?: string; user?: string; before?: string } }) {
  const m = await requirePage("audit.read");
  const members = await prisma.membership.findMany({ where: { orgId: m.orgId }, include: { user: { select: { id: true, email: true } } } });
  const where: Prisma.AuditLogWhereInput = { orgId: m.orgId, ...(sp.action ? { action: { startsWith: sp.action } } : {}), ...(sp.user ? { userId: sp.user === "system" ? null : sp.user } : {}), ...(sp.before ? { createdAt: { lt: new Date(sp.before) } } : {}) };
  const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  const who = (id: string | null) => (id ? members.find((x) => x.userId === id)?.user.email ?? "former member" : "system or API");
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change, send, export and personal-data view in this workspace." />
      <form className="flex flex-wrap gap-2" action="/settings/audit">
        <label htmlFor="aa" className="sr-only">Action</label><Input id="aa" name="action" defaultValue={sp.action} placeholder="Action starts with, e.g. contact. or pii." className="h-9 w-64" />
        <label htmlFor="au" className="sr-only">Person</label>
        <Select id="au" name="user" defaultValue={sp.user ?? ""} className="h-9 w-auto"><option value="">Anyone</option><option value="system">System or API</option>{members.map((x) => <option key={x.userId} value={x.userId}>{x.user.email}</option>)}</Select>
        <button className={buttonClass("secondary")}>Filter</button>
      </form>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <p className="text-sm text-muted">Nothing matches.</p> : (
          <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>When</th><th className={`${th} hidden sm:table-cell`}>Who</th><th className={th}>Action</th><th className={`${th} hidden md:table-cell`}>Details</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td className={`${td} tnum sm:whitespace-nowrap`}>{r.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}<span className="block text-xs text-muted sm:hidden">{who(r.userId)}</span></td><td className={`${td} hidden sm:table-cell`}>{who(r.userId)}</td><td className={`${td} font-mono text-[13px]`}>{r.action}{r.target && <span className="block font-sans text-xs text-muted">{r.target}</span>}</td><td className={`${td} hidden max-w-[360px] break-all text-xs text-muted md:table-cell`}>{r.meta ? JSON.stringify(r.meta) : ""}{r.ip ? ` · ${r.ip}` : ""}</td></tr>)}</tbody></table>
        )}
        {rows.length === 100 && <Link href={`/settings/audit?${new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), ...(sp.user ? { user: sp.user } : {}), before: rows[99].createdAt.toISOString() })}`} className={buttonClass("secondary", "mt-3")}>Older</Link>}
      </Card>
    </>
  );
}

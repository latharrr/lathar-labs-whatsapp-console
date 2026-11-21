import Link from "next/link";
import { can } from "@ll/db/src/permissions";
import { buttonClass } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/field";
import { PageHeader, td, th } from "@/components/ui/kit";
import { duration, getAnalytics, parseRange } from "@/lib/analytics";
import { int } from "@/lib/format";
import { requirePage } from "@/lib/session";
import { cn } from "@/lib/cn";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

export default async function AnalyticsPage({ searchParams: sp }: { searchParams: { from?: string; to?: string; days?: string; campaign?: string } }) {
  const m = await requirePage("analytics.read");
  const { from, to } = parseRange(sp);
  const a = await getAnalytics(m.orgId, from, to, sp.campaign);
  const max = Math.max(1, ...a.heat.map((h) => h.n));
  const top = Math.max(1, a.funnel[0]?.value ?? 0);
  const costDays = [...new Set(a.cost.map((c) => c.day))];
  const cats = [...new Set(a.cost.map((c) => c.category))];
  const ratesSet = a.cost.length > 0 && a.cost.every((c) => c.cost !== null);
  const qs = new URLSearchParams({ from: ymd(from), to: ymd(to), ...(sp.campaign ? { campaign: sp.campaign } : {}) }).toString();
  return (
    <div className="flex flex-col gap-4">
      {a.fixture && <p role="note" className="rounded-card border border-dashed border-line-strong px-4 py-3 text-sm"><Chip tone="warn">Test account</Chip> <span className="text-muted">These figures include a test account. Its data comes from local test events, not Meta.</span></p>}
      <PageHeader title="Analytics" subtitle={<>{ymd(from)} to {ymd(to)} · Asia/Kolkata{a.camp && <> · campaign <strong>{a.camp.name}</strong> (<Link href="/analytics" className="underline">all</Link>)</>}</>}
        actions={can(m.role, "analytics.export") ? <a href={`/api/export/analytics?${qs}`} className={buttonClass("secondary")}>Export CSV</a> : undefined} />
      <form className="flex flex-wrap items-end gap-2" action="/analytics">
        {sp.campaign && <input type="hidden" name="campaign" value={sp.campaign} />}
        <label className="flex flex-col gap-1 text-xs text-muted">From<Input type="date" name="from" defaultValue={ymd(from)} className="h-9 w-40" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">To<Input type="date" name="to" defaultValue={ymd(to)} className="h-9 w-40" /></label>
        <button className={buttonClass("secondary")}>Apply</button>
        {[7, 30, 90].map((d) => <Link key={d} href={`/analytics?days=${d}${sp.campaign ? `&campaign=${sp.campaign}` : ""}`} className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg">{d}d</Link>)}
      </form>

      <Card>
        <CardTitle>Funnel</CardTitle>
        <ol className="flex flex-col gap-2">
          {a.funnel.map((s, i) => (
            <li key={s.step} className="grid grid-cols-[96px_1fr_auto] items-center gap-3 text-sm">
              <span>{s.step}</span>
              <span className="h-2 overflow-hidden rounded-full bg-surface" aria-hidden><span className="block h-full rounded-full bg-accent" style={{ width: `${(s.value / top) * 100}%` }} /></span>
              <span className="tnum text-right">{int(s.value)} <span className="text-xs text-muted">{i ? pct(s.value, a.funnel[0].value) : ""}</span></span>
              {s.note && <span className="col-start-2 -mt-1 text-xs text-muted">{s.note}</span>}
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>When customers write</CardTitle>
          {a.heat.length === 0 ? <p className="text-sm text-muted">No customer messages in this range.</p> : (
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-0.5 text-[10px]" aria-label="Customer messages by weekday and hour">
                <thead><tr><th className="sr-only">Day</th>{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col" className="w-4 font-normal text-muted">{h % 6 === 0 ? h : ""}</th>)}</tr></thead>
                <tbody>{DAYS.map((d, di) => <tr key={d}><th scope="row" className="pr-1 text-left font-normal text-muted">{d}</th>{Array.from({ length: 24 }, (_, h) => {
                  const v = a.heat.find((x) => x.dow === di + 1 && x.hour === h)?.n ?? 0;
                  return <td key={h} title={`${d} ${h}:00 · ${v}`} className="size-4 rounded-sm" style={{ background: v ? `color-mix(in srgb, var(--accent) ${15 + (v / max) * 85}%, transparent)` : "var(--surface)" }}><span className="sr-only">{v}</span></td>;
                })}</tr>)}</tbody>
              </table>
              <p className="mt-2 text-xs text-muted">Darker means more customer messages in that hour (Asia/Kolkata).</p>
            </div>
          )}
        </Card>
        <Card>
          <CardTitle>Response times</CardTitle>
          <dl className="grid grid-cols-2 gap-4">
            <div><dt className="text-xs text-muted">Median first response</dt><dd className="tnum text-[28px] font-medium leading-9">{duration(a.allFirst)}</dd><dd className="text-xs text-muted">customer&apos;s first message to the first agent reply</dd></div>
            <div><dt className="text-xs text-muted">Median resolution</dt><dd className="tnum text-[28px] font-medium leading-9">{duration(a.allResolve)}</dd><dd className="text-xs text-muted">conversation opened to closed</dd></div>
          </dl>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <CardTitle>By agent</CardTitle>
        {a.agents.length === 0 ? <p className="text-sm text-muted">No agent replies or closed conversations in this range.</p> : (
          <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Agent</th><th className={`${th} text-right`}>Messages sent</th><th className={`${th} text-right`}>First response</th><th className={`${th} hidden text-right sm:table-cell`}>Resolution</th><th className={`${th} hidden text-right sm:table-cell`}>Closed</th></tr></thead>
            <tbody>{a.agents.map((g) => <tr key={g.id}><td className={td}>{g.name}</td><td className={`${td} tnum text-right`}>{int(g.sent)}</td><td className={`${td} tnum text-right`}>{duration(g.firstMedian)}</td><td className={`${td} tnum hidden text-right sm:table-cell`}>{duration(g.resolveMedian)}</td><td className={`${td} tnum hidden text-right sm:table-cell`}>{int(g.resolved)}</td></tr>)}</tbody></table>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <CardTitle>By campaign and segment</CardTitle>
        {a.campaigns.length === 0 ? <p className="text-sm text-muted">No campaigns ran in this range.</p> : (
          <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Campaign</th><th className={`${th} hidden md:table-cell`}>Segment</th><th className={`${th} text-right`}>Sent</th><th className={`${th} text-right`}>Read</th><th className={`${th} hidden text-right sm:table-cell`}>Clicked</th><th className={`${th} hidden text-right sm:table-cell`}>Replied</th><th className={`${th} hidden text-right lg:table-cell`}>Converted</th><th className={`${th} hidden text-right lg:table-cell`}>Failed</th></tr></thead>
            <tbody>{a.campaigns.map((c) => <tr key={c.id} className={cn(c.id === sp.campaign && "bg-accent-subtle")}><td className={td}><Link href={`/analytics?campaign=${c.id}`} className="underline">{c.name}</Link></td><td className={`${td} hidden md:table-cell`}>{c.segment ?? "All contacts"}</td><td className={`${td} tnum text-right`}>{int(c.sent)}</td><td className={`${td} tnum text-right`}>{int(c.read)} <span className="text-xs text-muted">{pct(c.read, c.sent)}</span></td><td className={`${td} tnum hidden text-right sm:table-cell`}>{int(c.clicked)}</td><td className={`${td} tnum hidden text-right sm:table-cell`}>{int(c.replied)}</td><td className={`${td} tnum hidden text-right lg:table-cell`}>{int(c.converted)}</td><td className={`${td} tnum hidden text-right lg:table-cell`}>{int(c.failed)}</td></tr>)}</tbody></table>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <CardTitle>By template</CardTitle>
          {a.templates.length === 0 ? <p className="text-sm text-muted">No templates sent from this dashboard in this range.</p> : (
            <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Template</th><th className={`${th} text-right`}>Sent</th><th className={`${th} text-right`}>Delivered</th><th className={`${th} text-right`}>Read</th></tr></thead>
              <tbody>{a.templates.map((t) => <tr key={t.name}><td className={td}>{t.name}</td><td className={`${td} tnum text-right`}>{int(t.sent)}</td><td className={`${td} tnum text-right`}>{int(t.delivered)}</td><td className={`${td} tnum text-right`}>{int(t.read)}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card className="overflow-x-auto">
          <CardTitle>Cost by category and day</CardTitle>
          {a.cost.length === 0 ? <p className="text-sm text-muted">No billable deliveries in this range.</p> : (
            <>
              <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Day</th>{cats.map((c) => <th key={c} className={`${th} text-right capitalize`}>{c}</th>)}</tr></thead>
                <tbody>{costDays.slice(-14).map((d) => <tr key={d}><td className={`${td} tnum`}>{d}</td>{cats.map((c) => { const x = a.cost.find((y) => y.day === d && y.category === c); return <td key={c} className={`${td} tnum text-right`}>{x ? (x.cost === null ? int(x.billable) : x.cost.toFixed(2)) : "0"}</td>; })}</tr>)}</tbody></table>
              <p className="mt-2 text-xs text-muted">{ratesSet ? `Estimated ${a.currency}, from the rates on this server.` : "Billable message counts. Cost is not shown because no verified rates are set."}{a.fixture ? " Test-account flags are samples." : ""} Last 14 days of the range shown; the CSV has all.</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireMember, canManage } from "@/lib/session";
import { getOverview, RANGES } from "@/lib/overview";
import { ago, int, limit, money, pctParts, quality } from "@/lib/format";
import { describeError } from "@/lib/meta-errors";
import { Card, CardTitle } from "@/components/ui/card";
import { Chip, type Tone } from "@/components/ui/chip";
import { buttonClass } from "@/components/ui/button";
import { Icon } from "@/components/icons";
import { DeliveredChart } from "@/components/area-chart";
import { cn } from "@/lib/cn";
import { LiveRefresh } from "@/components/live";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const sevTone = (s: string): Tone => (s === "critical" ? "err" : s === "warning" ? "warn" : "neutral");
const sevLabel = (s: string) => (s === "critical" ? "Critical" : s === "warning" ? "Warning" : "Info");

function Figure({ whole, frac }: { whole: string; frac?: string }) {
  return (
    <span className="tnum text-[28px] font-medium leading-[34px] tracking-[-0.01em]">
      {whole}
      {frac && <span className="text-base text-muted">{frac}</span>}
    </span>
  );
}

function Kpi({ label, whole, frac, sub }: { label: string; whole: string; frac?: string; sub: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-line px-5 py-4 [&:nth-child(2n)]:border-r-0 sm:border-r lg:border-b-0 lg:[&:nth-child(2n)]:border-r lg:last:border-r-0">
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">{label}</span>
      <Figure whole={whole} frac={frac} />
      <span className="tnum text-xs text-muted">{sub}</span>
    </div>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: { days?: string; number?: string } }) {
  const m = await requireMember();
  const days = RANGES.find((r) => String(r) === searchParams.days) ?? 7;
  const o = await getOverview(m.orgId, days, searchParams.number);
  const manage = canManage(m.role);
  const qs = (p: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    const merged = { days, number: searchParams.number, ...p };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && !(k === "days" && v === 7)) s.set(k, String(v));
    const str = s.toString();
    return str ? `/?${str}` : "/";
  };

  if (o.empty) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-[28px] font-[380] leading-9 tracking-[-0.01em]">Overview</h1>
        <Card className="flex flex-col items-start gap-3 py-10">
          <h2 className="text-base font-semibold">No WhatsApp number connected</h2>
          <p className="max-w-prose text-muted">
            Connect a WhatsApp Business Account to see delivery, reads, replies, cost and alerts here. Connecting only reads from Meta. It does not change your webhook.
          </p>
          {manage ? (
            <Link href="/settings" className={buttonClass("primary")}><Icon name="plus" size={14} />Connect number</Link>
          ) : (
            <p className="text-sm text-muted">Ask an Owner or Admin to connect one.</p>
          )}
        </Card>
      </div>
    );
  }

  const k = o.kpis;
  const delta = k.sent - k.prevSent;

  return (
    <div className="flex flex-col gap-6">
      {o.fixture && (
        <div role="note" className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-line-strong px-4 py-3">
          <Chip tone="warn">Test account</Chip>
          <span className="text-muted">
            This view includes a test account that is not connected to Meta. Its figures come from local test events, not from Meta.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <h1 className="text-[28px] font-[380] leading-9 tracking-[-0.01em]">Overview</h1>
          <p className="mt-1 text-muted">Last {days} days · Asia/Kolkata · {o.lastEventIsTest ? "last test event" : "last webhook"} {ago(o.lastEventAt)} · <LiveRefresh types={["status", "message"]} /></p>
        </div>
        <nav aria-label="Date range" className="flex gap-1 rounded-full border border-line bg-raised p-0.5">
          {RANGES.map((r) => (
            <Link key={r} href={qs({ days: r })} aria-current={r === days ? "true" : undefined}
              className={cn("rounded-full px-3 py-1.5 text-sm", r === days ? "bg-surface font-semibold" : "text-muted hover:text-fg")}>
              {r}d
            </Link>
          ))}
        </nav>
        {manage && <Link href="/settings" className={buttonClass("primary", "w-full sm:w-auto")}><Icon name="plus" size={14} />Connect number</Link>}
      </div>

      {o.numbers.length > 1 && (
        <nav aria-label="Phone number" className="flex flex-wrap gap-2">
          <Link href={qs({ number: undefined })} className={buttonClass("secondary", !searchParams.number ? "border-line-strong font-semibold" : "")}>All numbers</Link>
          {o.numbers.map((n) => (
            <Link key={n.id} href={qs({ number: n.id })} className={buttonClass("secondary", searchParams.number === n.id ? "border-line-strong font-semibold" : "")}>
              {n.displayPhoneNumber}
            </Link>
          ))}
        </nav>
      )}

      <section aria-label="Message KPIs" className="grid grid-cols-2 overflow-hidden rounded-card border border-line bg-raised sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Sent" whole={int(k.sent)} sub={delta === 0 ? `No change vs prev. ${days}d` : <><Icon name={delta > 0 ? "up" : "down"} size={12} className="inline" /> {delta > 0 ? "+" : "−"}{int(Math.abs(delta))} vs prev. {days}d</>} />
        <Kpi label="Delivered" whole={pctParts(k.deliveryPct)[0]} frac={pctParts(k.deliveryPct)[1]} sub={k.awaiting ? `${int(k.delivered)} · ${int(k.awaiting)} awaiting receipt` : `${int(k.delivered)} delivered`} />
        <Kpi label="Read" whole={pctParts(k.readPct)[0]} frac={pctParts(k.readPct)[1]} sub={`${int(k.read)} of delivered`} />
        <Kpi label="Replied" whole={pctParts(k.replyPct)[0]} frac={pctParts(k.replyPct)[1]} sub={`${int(k.replied)} of ${int(k.messagedConversations)} messaged chats`} />
        <Kpi label="Failed" whole={int(k.failed)} sub={k.sent ? `${((k.failed / k.sent) * 100).toFixed(1)}% of sent` : "nothing sent"} />
        <Kpi label="Windows opened" whole={int(k.windows)} sub={`${int(k.inbound)} inbound messages`} />
      </section>

      <details className="group -mt-3 rounded-card border border-line bg-raised px-4 py-3 sm:px-6">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
          <span className="flex-1 font-medium sm:flex-none">How these numbers are counted</span>
          <span data-testid="totals" className="tnum order-last w-full text-muted sm:order-none sm:w-auto sm:flex-1">
            {int(k.sent)} sent = {int(k.delivered)} delivered + {int(k.awaiting)} awaiting receipt + {int(k.failed)} failed{k.other ? ` + ${int(k.other)} other` : ""}
          </span>
          <Icon name="chevron" size={16} className="text-muted transition-transform duration-150 group-open:rotate-180" />
        </summary>
        <dl className="mt-3 grid gap-x-8 gap-y-3 border-t border-line pt-3 text-sm md:grid-cols-2">
          {[
            ["Sent", `Messages your numbers sent in the last ${days} days, counted from the status receipts Meta sends for them. Each one is delivered, awaiting receipt (Meta accepted it but has not confirmed delivery) or failed. The change compares with the ${days} days before.`],
            ["Delivered", "Delivered ÷ sent. A message that was read also counts as delivered. Messages awaiting receipt and failed messages are in the denominator, not the numerator."],
            ["Read", "Read ÷ delivered. Customers who turn off read receipts never show as read, so the real figure can be higher."],
            ["Replied", "Chats where the customer wrote after one of your messages ÷ chats you messaged in this range."],
            ["Failed", "Failed ÷ sent. The reasons are in Failures by error code below."],
            ["Windows opened", "Customer messages that opened a new 24-hour window, because the customer had not written in the previous 24 hours. The line below counts every customer message."],
          ].map(([t, d]) => (
            <div key={t}><dt className="font-medium">{t}</dt><dd className="mt-0.5 text-muted">{d}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">
          Days are Asia/Kolkata calendar days.
          {o.fixture && " The test account's statuses, pricing categories and billable flags are samples in local test events, not data from Meta."}
        </p>
      </details>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {o.selected.map((n) => {
            const q = quality(n.qualityRating);
            return (
              <Card key={n.id} aria-label={`Phone number ${n.displayPhoneNumber}`}>
                <CardTitle aside={
                  n.isFixture ? <Chip tone="warn">Test account, not connected to Meta</Chip>
                    : <Chip tone={n.status === "CONNECTED" ? "ok" : "warn"}>{n.status ? n.status.charAt(0) + n.status.slice(1).toLowerCase().replace(/_/g, " ") : "Unknown"}</Chip>
                }>Phone number</CardTitle>
                <div className="text-base font-semibold">{n.verifiedName ?? "Unnamed"}</div>
                <div className="tnum text-muted">{n.displayPhoneNumber} · {n.waba.name ?? n.waba.metaWabaId}</div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                  <div><dt className="text-xs text-muted">Quality rating</dt><dd className="mt-0.5"><Chip tone={q.tone}>{q.label}</Chip></dd></div>
                  <div><dt className="text-xs text-muted">Messaging limit (portfolio)</dt><dd className="tnum mt-0.5">{limit(n.messagingLimit)}</dd></div>
                  <div><dt className="text-xs text-muted">Throughput</dt><dd className="mt-0.5">{n.throughputLevel ? n.throughputLevel.toLowerCase() : "Unknown"}</dd></div>
                  <div><dt className="text-xs text-muted">Synced from Meta</dt><dd className="mt-0.5">{n.isFixture ? "Test data, never synced" : ago(n.syncedAt)}</dd></div>
                </dl>
              </Card>
            );
          })}
        </div>

        <Card aria-labelledby="chart-h">
          <CardTitle id="chart-h" aside={
            <div className="flex gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 bg-accent" />Delivered</span>
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="w-3 border-t-2 border-dashed border-line-strong" />Sent</span>
            </div>
          }>Delivered per day</CardTitle>
          {k.sent ? <DeliveredChart data={o.series} /> : <p className="py-16 text-center text-muted">No outbound messages in this range.</p>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-labelledby="cost-h">
          <CardTitle id="cost-h" aside={o.ratesSet && (() => {
            const total = o.cost.reduce((a, c) => a + (c.cost ?? 0), 0);
            const [w, f] = money(total, o.currency);
            return <span className="tnum text-xl font-medium">{w}<span className="text-sm text-muted">{f}</span></span>;
          })()}>Estimated cost</CardTitle>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-[13px] text-muted">
                <th scope="col" className="border-b border-line py-2 font-medium">Category</th>
                <th scope="col" className="border-b border-line py-2 text-right font-medium">Billable</th>
                <th scope="col" className="border-b border-line py-2 text-right font-medium">Est. {o.currency}</th>
              </tr>
            </thead>
            <tbody>
              {o.cost.map((c) => (
                <tr key={c.category} className="h-11 border-b border-line">
                  <td className="capitalize">{c.category}</td>
                  <td className="tnum text-right">{int(c.billable)}</td>
                  <td className="tnum text-right">{c.cost === null ? <span className="text-muted">not set</span> : c.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            {o.fixture
              ? "Billable counts are delivered messages flagged billable in the test events. Those flags are samples, not Meta's billing."
              : "Billable counts are delivered messages that Meta marked billable under per-message pricing."}{" "}
            {o.ratesSet
              ? "Rates are set on this server, not read from Meta, so check the estimate against your invoice."
              : "No rates are set, so there is no cost estimate yet."}
          </p>
        </Card>

        <Card aria-labelledby="alerts-h">
          <CardTitle id="alerts-h">Alerts</CardTitle>
          {o.systemAlerts.length + o.alerts.length === 0 ? (
            <p className="py-6 text-muted">No open alerts. Quality drops, template rejections, account notices and webhook problems show up here.</p>
          ) : (
            <ul>
              {[...o.systemAlerts.map((a, i) => ({ ...a, id: `sys${i}`, when: "now" })), ...o.alerts.map((a) => ({ ...a, when: ago(a.createdAt) }))].map((a) => (
                <li key={a.id} className="flex items-start gap-3 border-b border-line py-3 last:border-b-0">
                  <Chip tone={sevTone(a.severity)} className="min-w-[64px] justify-center">{sevLabel(a.severity)}</Chip>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{a.title}</div>
                    {a.detail && <div className="text-xs text-muted">{a.detail}</div>}
                  </div>
                  <span className="tnum whitespace-nowrap text-xs text-muted">{a.when}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card aria-labelledby="err-h">
        <CardTitle id="err-h">Failures by error code</CardTitle>
        {o.failures.length === 0 ? (
          <p className="py-4 text-muted">No failed messages in this range.</p>
        ) : (
          <div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-[13px] text-muted">
                  <th scope="col" className="border-b border-line py-2 font-medium">Reason</th>
                  <th scope="col" className="hidden border-b border-line py-2 font-medium sm:table-cell">Retry</th>
                  <th scope="col" className="border-b border-line py-2 pl-3 text-right font-medium">Count</th>
                </tr>
              </thead>
              <tbody>
                {o.failures.map((f) => {
                  const d = describeError(f.code);
                  return (
                    <tr key={String(f.code)} className="h-11 border-b border-line last:border-b-0">
                      <td className="py-2.5">
                        {d.meaning}
                        <span className="block text-xs text-muted">
                          Meta code <span className="font-mono">{f.code ?? "none"}</span>
                          <span className="sm:hidden"> · {d.retryable ? "retry with backoff" : "do not retry"}</span>
                        </span>
                      </td>
                      <td className="hidden py-2.5 align-top text-muted sm:table-cell">{d.retryable ? "Yes, with backoff" : "No"}</td>
                      <td className="tnum py-2.5 pl-3 text-right align-top">{int(f.count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

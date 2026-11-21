import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@ll/db";
import { precheck, type Variant } from "@ll/db/src/campaigns";
import { RETRYABLE_CODES } from "@ll/db/src/graph";
import { can } from "@ll/db/src/permissions";
import { limitLabel } from "@ll/db";
import { ConfirmForm } from "@/components/action-form";
import { LiveRefresh } from "@/components/live";
import { Card, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { PageHeader, StatusChip, td, th } from "@/components/ui/kit";
import { int, money, quality } from "@/lib/format";
import { describeError } from "@/lib/meta-errors";
import { requirePage } from "@/lib/session";
import { changeState, deleteDraftCampaign, launch, retryFailed } from "../actions";

export const metadata = { title: "Campaign" };
export const dynamic = "force-dynamic";

const SKIP: Record<string, string> = { no_opt_in: "No recorded marketing opt-in", opted_out: "Opted out", blocked: "Blocked" };

export default async function CampaignPage({ params }: { params: { id: string } }) {
  const m = await requirePage("analytics.read");
  const c = await prisma.campaign.findFirst({ where: { id: params.id, orgId: m.orgId }, include: { phoneNumber: { include: { waba: true } }, segment: true } });
  if (!c) notFound();
  const variants = c.variants as Variant[];
  const templates = await prisma.template.findMany({ where: { id: { in: variants.map((v) => v.templateId) }, waba: { orgId: m.orgId } } });
  const send = can(m.role, "campaigns.send");
  const isTest = c.phoneNumber.isFixture || c.phoneNumber.waba.isFixture;
  const header = (
    <PageHeader title={c.name} subtitle={<>{c.phoneNumber.displayPhoneNumber} · {c.segment?.name ?? "All contacts"} · {c.throttlePerMinute}/min{c.status !== "draft" && <> · <LiveRefresh types={["campaign", "status"]} /></>}</>}
      actions={<>
        <StatusChip status={c.status} />
        {send && c.status === "running" && <ConfirmForm action={changeState} hidden={{ id: c.id, action: "pause" }} label="Pause" title="Pause this campaign?" body="Queued messages wait. Nothing new is sent until you resume." confirm="Pause" />}
        {send && c.status === "paused" && <ConfirmForm action={changeState} hidden={{ id: c.id, action: "resume" }} label="Resume" title="Resume sending?" body="Sending continues at the throttle you set. Each message is checked against opt-outs again right before it goes." confirm="Resume" />}
        {send && ["running", "paused", "scheduled"].includes(c.status) && <ConfirmForm action={changeState} hidden={{ id: c.id, action: "cancel" }} variant="danger" tone="danger" label="Cancel" title="Cancel this campaign?" body="Queued messages are cancelled and nothing more is sent. Messages already sent cannot be recalled." confirm="Cancel campaign" />}
      </>} />
  );

  if (c.status === "draft") {
    const pre = await precheck(prisma, m.orgId, { phoneNumberId: c.phoneNumberId, segmentId: c.segmentId, variants });
    const q = quality(pre.quality);
    const blockers = [!pre.templatesApproved && "A template is no longer approved.", pre.quality === "RED" && "The number's quality is low.", !pre.eligible && "No one in this audience has a recorded opt-in."].filter(Boolean) as string[];
    const cost = pre.cost ? money(pre.cost.amount, pre.cost.currency) : null;
    return (
      <div className="flex flex-col gap-4">
        {header}
        {isTest && <p className="rounded-control border border-dashed border-line-strong px-4 py-3 text-sm"><Chip tone="warn">Test account</Chip> <span className="text-muted">Launching sends nothing to WhatsApp. Messages are recorded locally as test sends.</span></p>}
        <Card>
          <CardTitle>Pre-send checks</CardTitle>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs text-muted">Will receive it</dt><dd className="tnum text-[28px] font-medium leading-9">{int(pre.eligible)}</dd><dd className="text-xs text-muted">of {int(pre.audience)} in the audience</dd></div>
            <div><dt className="text-xs text-muted">Messaging limit</dt><dd className="mt-1">{limitLabel(c.phoneNumber.messagingLimit)}</dd>{pre.overLimit && <dd className="text-xs text-warn">The audience is over the limit: the rest wait until the 24-hour window allows them.</dd>}</div>
            <div><dt className="text-xs text-muted">Quality rating</dt><dd className="mt-1"><Chip tone={q.tone}>{q.label}</Chip></dd></div>
            <div><dt className="text-xs text-muted">Estimated cost</dt><dd className="tnum mt-1">{cost ? <>{cost[0]}<span className="text-muted">{cost[1]}</span></> : <span className="text-muted">Not set</span>}</dd><dd className="text-xs text-muted">{cost ? "From the rates on this server, not Meta's invoice." : "No verified rates are configured, so there is no estimate."}</dd></div>
          </dl>
          {Object.keys(pre.skipped).length > 0 && <ul className="mt-4 text-sm text-muted">{Object.entries(pre.skipped).map(([k, n]) => <li key={k}>{int(n)} skipped: {SKIP[k] ?? k}</li>)}</ul>}
          {blockers.length > 0 && <ul className="mt-3 rounded-control bg-err-bg px-3 py-2 text-sm text-err">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        </Card>
        <Card>
          <CardTitle>Content</CardTitle>
          <ul className="flex flex-col gap-2 text-sm">{variants.map((v, i) => <li key={i}>{variants.length > 1 && <span className="font-medium">Variant {"AB"[i]} ({v.weight}%): </span>}{templates.find((t) => t.id === v.templateId)?.name} · <span className="font-mono text-xs text-muted">{Object.entries(v.variables).map(([s, x]) => `${s}=${x}`).join("  ")}</span></li>)}</ul>
          <p className="mt-2 text-sm text-muted">{c.scheduledAt ? `Scheduled for ${c.scheduledAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} (Asia/Kolkata).` : "Sends as soon as you launch it."}</p>
        </Card>
        {send && (
          <div className="flex flex-wrap gap-2">
            <ConfirmForm action={launch} hidden={{ id: c.id }} variant="primary" disabled={blockers.length > 0} label={c.scheduledAt ? "Schedule" : "Launch"}
              title={`${c.scheduledAt ? "Schedule" : "Send"} to ${int(pre.eligible)} contacts?`}
              body={<>Each message is checked against opt-outs and blocks again right before it is sent. You can pause or cancel at any time.{isTest ? " Test account: nothing reaches WhatsApp." : ""}</>} confirm={c.scheduledAt ? "Schedule" : "Send now"} />
            <ConfirmForm action={deleteDraftCampaign} hidden={{ id: c.id }} variant="danger" tone="danger" label="Delete draft" title="Delete this draft?" body="Nothing has been sent. This cannot be undone." confirm="Delete" />
          </div>
        )}
      </div>
    );
  }

  const [byStatus, replied, clicked, converted, failures, byVariant, links, skipped] = await Promise.all([
    prisma.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: c.id }, _count: { _all: true } }),
    prisma.campaignRecipient.count({ where: { campaignId: c.id, repliedAt: { not: null } } }),
    prisma.campaignRecipient.count({ where: { campaignId: c.id, clickedAt: { not: null } } }),
    prisma.campaignRecipient.count({ where: { campaignId: c.id, convertedAt: { not: null } } }),
    prisma.campaignRecipient.groupBy({ by: ["errorCode"], where: { campaignId: c.id, status: "failed" }, _count: { _all: true } }),
    prisma.campaignRecipient.groupBy({ by: ["variant", "status"], where: { campaignId: c.id }, _count: { _all: true } }),
    prisma.trackedLink.aggregate({ where: { campaignId: c.id }, _sum: { clicks: true } }),
    prisma.campaignRecipient.groupBy({ by: ["skipReason"], where: { campaignId: c.id, status: { in: ["skipped", "cancelled"] } }, _count: { _all: true } }),
  ]);
  const n = (s: string[]) => byStatus.filter((b) => s.includes(b.status)).reduce((a, b) => a + b._count._all, 0);
  const sent = n(["sent", "delivered", "read"]);
  const kpis: [string, number, string?][] = [
    ["Queued", n(["pending", "queued"])], ["Sent", sent], ["Delivered", n(["delivered", "read"])], ["Read", n(["read"])],
    ["Replied", replied], ["Clicked", clicked, `${int(links._sum.clicks ?? 0)} total clicks`], ["Failed", n(["failed"])], ["Skipped", n(["skipped", "cancelled"])],
  ];
  const retryable = failures.filter((f) => f.errorCode !== null && RETRYABLE_CODES.has(f.errorCode)).reduce((a, f) => a + f._count._all, 0);
  return (
    <div className="flex flex-col gap-4">
      {header}
      {isTest && <p className="rounded-control border border-dashed border-line-strong px-4 py-3 text-sm"><Chip tone="warn">Test account</Chip> <span className="text-muted">These are local test sends. Nothing reached WhatsApp, so there are no delivery or read receipts.</span></p>}
      <section aria-label="Progress" className="grid grid-cols-2 overflow-hidden rounded-card border border-line bg-raised sm:grid-cols-4">
        {kpis.map(([label, v, sub]) => (
          <div key={label} className="flex flex-col gap-1 border-b border-r border-line px-5 py-4">
            <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">{label}</span>
            <span className="tnum text-[28px] font-medium leading-[34px]">{int(v)}</span>
            {sub && <span className="text-xs text-muted">{sub}</span>}
          </div>
        ))}
      </section>
      <p className="text-xs text-muted">Converted: {int(converted)}, counted from conversion or order.placed events your systems send within 7 days of a campaign message.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <CardTitle aside={send && retryable > 0 ? <ConfirmForm action={retryFailed} hidden={{ id: c.id }} label={`Retry ${retryable}`} title={`Retry ${retryable} failed messages?`} body="Only failures Meta calls temporary are retried. Opt-outs and blocks are checked again." confirm="Retry" /> : undefined}>Failures by reason</CardTitle>
          {failures.length === 0 ? <p className="text-sm text-muted">No failures.</p> : (
            <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Reason</th><th className={`${th} hidden sm:table-cell`}>Retry</th><th className={`${th} text-right`}>Count</th></tr></thead>
              <tbody>{failures.map((f) => { const d = describeError(f.errorCode); return <tr key={String(f.errorCode)}><td className={td}>{d.meaning}<span className="block text-xs text-muted">Meta code <span className="font-mono">{f.errorCode ?? "none"}</span></span></td><td className={`${td} hidden sm:table-cell`}>{f.errorCode !== null && RETRYABLE_CODES.has(f.errorCode) ? "Yes" : "No"}</td><td className={`${td} tnum text-right`}>{int(f._count._all)}</td></tr>; })}</tbody></table>
          )}
        </Card>
        <Card className="overflow-x-auto">
          <CardTitle>{variants.length > 1 ? "A/B variants" : "Template"}</CardTitle>
          <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Variant</th><th className={`${th} text-right`}>Sent</th><th className={`${th} text-right`}>Read</th></tr></thead>
            <tbody>{variants.map((v, i) => { const g = (ss: string[]) => byVariant.filter((b) => b.variant === i && ss.includes(b.status)).reduce((a, b) => a + b._count._all, 0); return <tr key={i}><td className={td}>{variants.length > 1 ? `${"AB"[i]} · ` : ""}{templates.find((t) => t.id === v.templateId)?.name}</td><td className={`${td} tnum text-right`}>{int(g(["sent", "delivered", "read"]))}</td><td className={`${td} tnum text-right`}>{int(g(["read"]))}</td></tr>; })}</tbody></table>
          {skipped.length > 0 && <ul className="mt-3 text-sm text-muted">{skipped.map((s) => <li key={String(s.skipReason)}>{int(s._count._all)} skipped or cancelled: {SKIP[s.skipReason ?? ""] ?? s.skipReason ?? "cancelled"}</li>)}</ul>}
          <p className="mt-3 text-sm"><Link href={`/analytics?campaign=${c.id}`} className="underline">Funnel and reply times in Analytics</Link></p>
        </Card>
      </div>
    </div>
  );
}

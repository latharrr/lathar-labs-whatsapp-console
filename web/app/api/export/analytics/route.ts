import { toCsv } from "@ll/db/src/contacts";
import { audit } from "@/lib/audit";
import { getAnalytics, parseRange } from "@/lib/analytics";
import { can } from "@ll/db/src/permissions";
import { requireMember } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const m = await requireMember();
  if (!can(m.role, "analytics.export")) return Response.json({ error: "Only Owners and Admins can export." }, { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const { from, to } = parseRange(sp);
  const a = await getAnalytics(m.orgId, from, to, sp.campaign);
  const rows: unknown[][] = [
    ["section", "name", "metric", "value"],
    ...a.funnel.map((f) => ["funnel", "", f.step, f.value]),
    ...a.campaigns.flatMap((c) => (["sent", "delivered", "read", "replied", "clicked", "converted", "failed"] as const).map((k) => ["campaign", c.name, k, c[k]])),
    ...a.templates.flatMap((t) => (["sent", "delivered", "read"] as const).map((k) => ["template", t.name, k, t[k]])),
    ...a.agents.flatMap((g) => [["agent", g.name, "messages_sent", g.sent], ["agent", g.name, "first_response_median_minutes", g.firstMedian === null ? "" : Math.round(g.firstMedian / 60000)], ["agent", g.name, "resolution_median_minutes", g.resolveMedian === null ? "" : Math.round(g.resolveMedian / 60000)]]),
    ...a.cost.map((c) => ["billable", c.day, c.category, c.billable]),
    ...a.cost.filter((c) => c.cost !== null).map((c) => ["cost_estimate_" + a.currency, c.day, c.category, c.cost!.toFixed(2)]),
    ...a.heat.map((h) => ["inbound_by_hour", `isodow ${h.dow}`, `hour ${h.hour}`, h.n]),
  ];
  await audit(m, "analytics.export", undefined, { from: from.toISOString(), to: to.toISOString() });
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="analytics-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}

import { prisma, Prisma } from "@ll/db";

const TZ = "Asia/Kolkata";
const DAY = 86_400_000;

export function parseRange(sp: { from?: string; to?: string; days?: string }) {
  const days = Number(sp.days) || 30;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? new Date(`${sp.to}T23:59:59.999+05:30`) : new Date();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? new Date(`${sp.from}T00:00:00+05:30`) : new Date(to.getTime() - days * DAY);
  return { from, to: to < from ? from : to };
}

const n = (v: unknown) => Number(v ?? 0);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export async function getAnalytics(orgId: string, from: Date, to: Date, campaignId?: string) {
  const rangeMsg = Prisma.sql`m."orgId" = ${orgId} AND m.timestamp >= ${from} AND m.timestamp <= ${to}`;
  const camp = campaignId ? await prisma.campaign.findFirst({ where: { id: campaignId, orgId } }) : null;
  const fixture = (await prisma.phoneNumber.count({ where: { waba: { orgId }, isFixture: true } })) > 0;

  // Funnel. Without a campaign: messages for sent..replied, campaign recipients for clicked/converted.
  let funnel: { step: string; value: number; note: string }[];
  if (camp) {
    const r = await prisma.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: camp.id }, _count: { _all: true } });
    const c = (s: string[]) => r.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count._all, 0);
    const [replied, clicked, converted] = await Promise.all(["repliedAt", "clickedAt", "convertedAt"].map((k) => prisma.campaignRecipient.count({ where: { campaignId: camp.id, [k]: { not: null } } })));
    funnel = [
      { step: "Sent", value: c(["sent", "delivered", "read"]), note: "recipients Meta accepted" },
      { step: "Delivered", value: c(["delivered", "read"]), note: "" }, { step: "Read", value: c(["read"]), note: "" },
      { step: "Clicked", value: clicked, note: "tracked link opened" }, { step: "Replied", value: replied, note: "wrote back within 72 h" },
      { step: "Converted", value: converted, note: "conversion event within 7 days" },
    ];
  } else {
    const [row] = await prisma.$queryRaw<{ sent: bigint; delivered: bigint; read: bigint; replied: bigint }[]>`
      SELECT count(*) sent, count(*) FILTER (WHERE m.status IN ('delivered','read')) delivered, count(*) FILTER (WHERE m.status = 'read') read,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Message" i WHERE i."conversationId" = m."conversationId" AND i.direction = 'IN' AND i.timestamp > m.timestamp AND i.timestamp < m.timestamp + interval '72 hours')) replied
      FROM "Message" m WHERE ${rangeMsg} AND m.direction = 'OUT'`;
    const [clicked, converted] = await Promise.all([
      prisma.campaignRecipient.count({ where: { campaign: { orgId }, clickedAt: { gte: from, lte: to } } }),
      prisma.campaignRecipient.count({ where: { campaign: { orgId }, convertedAt: { gte: from, lte: to } } }),
    ]);
    funnel = [
      { step: "Sent", value: n(row?.sent), note: "outbound messages" }, { step: "Delivered", value: n(row?.delivered), note: "" }, { step: "Read", value: n(row?.read), note: "" },
      { step: "Clicked", value: clicked, note: "campaign links only" }, { step: "Replied", value: n(row?.replied), note: "customer wrote within 72 h" },
      { step: "Converted", value: converted, note: "campaign conversions" },
    ];
  }

  const [campaigns, templates, agentsRaw, heat, costRaw, convs] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; segment: string | null; sent: bigint; delivered: bigint; read: bigint; replied: bigint; clicked: bigint; converted: bigint; failed: bigint }[]>`
      SELECT c.id, c.name, s.name segment,
        count(*) FILTER (WHERE r.status IN ('sent','delivered','read')) sent, count(*) FILTER (WHERE r.status IN ('delivered','read')) delivered,
        count(*) FILTER (WHERE r.status = 'read') read, count(r."repliedAt") replied, count(r."clickedAt") clicked, count(r."convertedAt") converted,
        count(*) FILTER (WHERE r.status = 'failed') failed
      FROM "Campaign" c LEFT JOIN "Segment" s ON s.id = c."segmentId" LEFT JOIN "CampaignRecipient" r ON r."campaignId" = c.id
      WHERE c."orgId" = ${orgId} AND c."createdAt" <= ${to} AND (c."completedAt" IS NULL OR c."completedAt" >= ${from}) AND c.status <> 'draft'
      GROUP BY c.id, c.name, s.name ORDER BY max(c."createdAt") DESC LIMIT 50`,
    prisma.$queryRaw<{ name: string; sent: bigint; delivered: bigint; read: bigint }[]>`
      SELECT o.payload->'template'->>'name' AS name, count(*) sent,
        count(*) FILTER (WHERE m.status IN ('delivered','read')) delivered, count(*) FILTER (WHERE m.status = 'read') read
      FROM "OutboundMessage" o LEFT JOIN "Message" m ON m."outboundId" = o.id
      WHERE o."orgId" = ${orgId} AND o.kind = 'template' AND o.status = 'sent' AND o."sentAt" >= ${from} AND o."sentAt" <= ${to}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
    prisma.$queryRaw<{ userId: string; sent: bigint }[]>`
      SELECT m."sentById" "userId", count(*) sent FROM "Message" m WHERE ${rangeMsg} AND m.direction = 'OUT' AND m."sentById" IS NOT NULL GROUP BY 1`,
    prisma.$queryRaw<{ dow: number; hour: number; n: bigint }[]>`
      SELECT extract(isodow FROM (m.timestamp AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int dow, extract(hour FROM (m.timestamp AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int AS "hour", count(*) n
      FROM "Message" m WHERE ${rangeMsg} AND m.direction = 'IN' GROUP BY 1, 2`,
    prisma.$queryRaw<{ d: string; category: string | null; n: bigint }[]>`
      SELECT to_char(date_trunc('day', (m.timestamp AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}), 'YYYY-MM-DD') d, m."pricingCategory" category, count(*) n
      FROM "Message" m WHERE ${rangeMsg} AND m.direction = 'OUT' AND m.billable AND m.status IN ('delivered','read') GROUP BY 1, 2 ORDER BY 1`,
    prisma.conversation.findMany({
      where: { orgId, OR: [{ firstResponseAt: { gte: from, lte: to } }, { closedAt: { gte: from, lte: to } }] },
      select: { id: true, assigneeId: true, createdAt: true, firstResponseAt: true, closedAt: true, messages: { where: { direction: "IN" }, orderBy: { timestamp: "asc" }, take: 1, select: { timestamp: true } } },
    }),
  ]);

  // first response: first agent reply after the customer's first message; resolution: opened to closed
  const users = await prisma.user.findMany({ where: { memberships: { some: { orgId } } }, select: { id: true, name: true, email: true } });
  const per = new Map<string, { first: number[]; resolve: number[]; sent: number }>();
  const bucket = (id: string) => { let b = per.get(id); if (!b) per.set(id, (b = { first: [], resolve: [], sent: 0 })); return b; };
  for (const c of convs) {
    const k = c.assigneeId ?? "unassigned";
    const firstIn = c.messages[0]?.timestamp;
    if (c.firstResponseAt && firstIn && c.firstResponseAt >= firstIn) bucket(k).first.push(c.firstResponseAt.getTime() - firstIn.getTime());
    if (c.closedAt) bucket(k).resolve.push(c.closedAt.getTime() - c.createdAt.getTime());
  }
  for (const a of agentsRaw) bucket(a.userId).sent = n(a.sent);
  const agents = [...per.entries()].map(([id, b]) => {
    const u = users.find((x) => x.id === id);
    return { id, name: id === "unassigned" ? "Unassigned" : u?.name ?? u?.email ?? "Former member", sent: b.sent, firstMedian: median(b.first), firstCount: b.first.length, resolveMedian: median(b.resolve), resolved: b.resolve.length };
  }).sort((a, b) => b.sent - a.sent);
  const allFirst = median(convs.flatMap((c) => (c.firstResponseAt && c.messages[0] && c.firstResponseAt >= c.messages[0].timestamp ? [c.firstResponseAt.getTime() - c.messages[0].timestamp.getTime()] : [])));
  const allResolve = median(convs.flatMap((c) => (c.closedAt ? [c.closedAt.getTime() - c.createdAt.getTime()] : [])));

  let rates: Record<string, number> = {};
  try { rates = JSON.parse(process.env.PRICING_RATES || "{}"); } catch {}
  const rate = (c: string | null) => (c && typeof rates[c] === "number" && rates[c] > 0 ? rates[c] : null);
  const cost = costRaw.map((r) => ({ day: r.d, category: r.category ?? "unknown", billable: n(r.n), cost: rate(r.category) === null ? null : n(r.n) * rate(r.category)! }));

  return {
    camp, fixture, funnel,
    campaigns: campaigns.map((c) => ({ ...c, sent: n(c.sent), delivered: n(c.delivered), read: n(c.read), replied: n(c.replied), clicked: n(c.clicked), converted: n(c.converted), failed: n(c.failed) })),
    templates: templates.map((t) => ({ name: t.name ?? "unknown", sent: n(t.sent), delivered: n(t.delivered), read: n(t.read) })),
    agents, allFirst, allResolve,
    heat: heat.map((h) => ({ dow: h.dow, hour: h.hour, n: n(h.n) })),
    cost, currency: process.env.PRICING_CURRENCY || "INR",
  };
}

export const duration = (ms: number | null) => {
  if (ms === null) return "No data";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = ms / 3_600_000;
  return h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`;
};

import { prisma, Prisma } from "@ll/db";

export const RANGES = [7, 30, 90] as const;
const TZ = "Asia/Kolkata";
const DAY = 86_400_000;

function rates(): Record<string, number> {
  try {
    const r = JSON.parse(process.env.PRICING_RATES || "{}");
    return Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === "number" && v > 0)) as Record<string, number>;
  } catch {
    return {};
  }
}

const pct = (n: number, d: number) => (d ? (n / d) * 100 : null);

export async function getOverview(orgId: string, days: number, numberId?: string) {
  const from = new Date(Date.now() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);

  const numbers = await prisma.phoneNumber.findMany({
    where: { waba: { orgId } },
    include: { waba: { select: { name: true, metaWabaId: true, isFixture: true, tokenValid: true, tokenExpiresAt: true, tokenCheckedAt: true } } },
    orderBy: { displayPhoneNumber: "asc" },
  });
  const selected = numberId ? numbers.filter((n) => n.id === numberId) : numbers;
  const ids = selected.map((n) => n.id);
  const fixture = selected.some((n) => n.isFixture);
  if (!ids.length) return { numbers, selected, fixture, empty: true as const };

  const inIds = Prisma.join(ids);
  const outWhere = { orgId, phoneNumberId: { in: ids }, direction: "OUT" as const };

  const [byStatus, prevSent, inbound, windows, replied, outConvs, daily, billable, failures, alerts, stuck, failing, lastEvent] = await Promise.all([
    prisma.message.groupBy({ by: ["status"], where: { ...outWhere, timestamp: { gte: from } }, _count: { _all: true } }),
    prisma.message.count({ where: { ...outWhere, timestamp: { gte: prevFrom, lt: from } } }),
    prisma.message.count({ where: { orgId, phoneNumberId: { in: ids }, direction: "IN", timestamp: { gte: from } } }),
    prisma.message.count({ where: { orgId, phoneNumberId: { in: ids }, direction: "IN", opensWindow: true, timestamp: { gte: from } } }),
    // a conversation "replied" when the customer wrote after one of our messages in the range
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT o."conversationId") AS n FROM "Message" o
      JOIN "Message" i ON i."conversationId" = o."conversationId" AND i.direction = 'IN' AND i.timestamp > o.timestamp
      WHERE o.direction = 'OUT' AND o.timestamp >= ${from} AND o."phoneNumberId" IN (${inIds})`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT "conversationId") AS n FROM "Message"
      WHERE direction = 'OUT' AND timestamp >= ${from} AND "phoneNumberId" IN (${inIds}) AND "conversationId" IS NOT NULL`,
    prisma.$queryRaw<{ d: string; sent: bigint; delivered: bigint }[]>`
      SELECT to_char(date_trunc('day', (timestamp AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS d,
             count(*) AS sent, count(*) FILTER (WHERE status IN ('delivered', 'read')) AS delivered
      FROM "Message" WHERE direction = 'OUT' AND timestamp >= ${from} AND "phoneNumberId" IN (${inIds})
      GROUP BY 1 ORDER BY 1`,
    // per-message pricing charges on delivery, so a sent-but-never-delivered message is not counted
    prisma.message.groupBy({ by: ["pricingCategory"], where: { ...outWhere, billable: true, status: { in: ["delivered", "read"] }, timestamp: { gte: from } }, _count: { _all: true } }),
    prisma.message.groupBy({ by: ["errorCode"], where: { ...outWhere, status: "failed", timestamp: { gte: from } }, _count: { _all: true }, orderBy: { _count: { errorCode: "desc" } }, take: 8 }),
    prisma.alert.findMany({ where: { orgId, resolvedAt: null, OR: [{ phoneNumberId: null }, { phoneNumberId: { in: ids } }] }, orderBy: { createdAt: "desc" }, take: 8 }),
    // events not yet processed after 5 minutes usually mean the worker is down
    prisma.webhookEvent.count({ where: { orgId, processedAt: null, receivedAt: { lt: new Date(Date.now() - 5 * 60_000) } } }),
    prisma.webhookEvent.count({ where: { orgId, processedAt: null, attempts: { gte: 3 } } }),
    prisma.webhookEvent.findFirst({ where: { orgId }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true, rawBody: true } }),
  ]);

  const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const read = count("read");
  const delivered = count("delivered") + read;
  const failed = count("failed");
  const awaiting = count("sent"); // accepted by Meta, no delivery receipt yet
  const sent = byStatus.reduce((a, r) => a + r._count._all, 0);
  // every outbound message is in exactly one bucket, so the breakdown always adds up to Sent
  const other = sent - delivered - awaiting - failed;
  const repliedN = Number(replied[0]?.n ?? 0);
  const outConvN = Number(outConvs[0]?.n ?? 0);

  // one point per local day, zero-filled, so gaps show as gaps and not as interpolation
  const byDay = new Map(daily.map((r) => [r.d, r]));
  const series = Array.from({ length: days }, (_, k) => {
    const d = new Date(Date.now() - (days - 1 - k) * DAY).toLocaleDateString("en-CA", { timeZone: TZ });
    const r = byDay.get(d);
    return { day: d, sent: Number(r?.sent ?? 0), delivered: Number(r?.delivered ?? 0) };
  });

  const rate = rates();
  const categories = ["marketing", "utility", "authentication", "service"];
  const extra = billable.map((b) => b.pricingCategory ?? "unknown").filter((c) => !categories.includes(c));
  const cost = [...categories, ...extra].map((cat) => {
    const n = billable.find((b) => (b.pricingCategory ?? "unknown") === cat)?._count._all ?? 0;
    return { category: cat, billable: n, cost: rate[cat] !== undefined ? n * rate[cat] : null };
  });
  // with no rates at all there is nothing to estimate, even when every count is 0
  const ratesSet = Object.keys(rate).length > 0 && cost.every((c) => c.billable === 0 || c.cost !== null);

  const now = Date.now();
  const tokenAlerts = Array.from(new Map(selected.map((n) => [n.waba.metaWabaId, n.waba])).values()).flatMap((w) => {
    if (w.tokenValid === false) return [{ severity: "critical", title: `Access token for ${w.name ?? w.metaWabaId} is invalid`, detail: "Reconnect it in Settings." }];
    if (w.tokenExpiresAt && w.tokenExpiresAt.getTime() - now < 7 * DAY)
      return [{ severity: "warning", title: `Access token expires ${w.tokenExpiresAt.toLocaleDateString("en-IN", { timeZone: TZ })}`, detail: "Use a System User token that never expires." }];
    return [];
  });
  const systemAlerts = [
    ...tokenAlerts,
    ...(stuck ? [{ severity: "critical", title: `${stuck} webhook event${stuck > 1 ? "s" : ""} waiting over 5 minutes`, detail: "Is the worker running? npm run worker" }] : []),
    ...(failing ? [{ severity: "critical", title: `${failing} webhook event${failing > 1 ? "s" : ""} failing to process`, detail: "Retrying with backoff. Errors are stored on each event." }] : []),
  ];

  // "Last test event" when the newest webhook was for a test account, so a fixture is never shown as live traffic
  const fixtureWabas = new Set(numbers.filter((n) => n.waba.isFixture).map((n) => n.waba.metaWabaId));
  let lastEventIsTest = false;
  try {
    const body = JSON.parse(lastEvent?.rawBody ?? "{}");
    lastEventIsTest = Array.isArray(body.entry) && body.entry.length > 0 && body.entry.every((e: { id?: string }) => fixtureWabas.has(String(e.id)));
  } catch {}

  return {
    numbers, selected, fixture, empty: false as const,
    kpis: {
      sent, prevSent, delivered, read, failed, awaiting, other, inbound, windows, replied: repliedN,
      deliveryPct: pct(delivered, sent), readPct: pct(read, delivered), replyPct: pct(repliedN, outConvN), messagedConversations: outConvN,
    },
    series, cost, ratesSet, currency: process.env.PRICING_CURRENCY || "INR",
    failures: failures.map((f) => ({ code: f.errorCode, count: f._count._all })),
    alerts, systemAlerts, lastEventAt: lastEvent?.receivedAt ?? null, lastEventIsTest,
  };
}

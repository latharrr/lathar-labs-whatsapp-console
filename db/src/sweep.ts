/** Periodic repair for jobs that never ran: lost webhook jobs, lost send jobs, and sends cut off mid-request. */
import type { PrismaClient } from "@prisma/client";
import type { Jobs } from "./jobs";

export async function sweep(db: PrismaClient, jobs: Jobs, enqueueEvent: (id: string) => Promise<unknown>) {
  // webhook events stored while Redis was down never got a job
  const stale = await db.webhookEvent.findMany({
    where: { processedAt: null, attempts: 0, receivedAt: { lt: new Date(Date.now() - 60_000) } },
    select: { id: true }, take: 200, orderBy: { receivedAt: "asc" },
  });
  for (const e of stale) await enqueueEvent(e.id);
  // queued sends whose job was lost; the claim makes a duplicate job harmless
  const queued = await db.outboundMessage.findMany({
    where: { status: "queued", OR: [{ notBefore: null }, { notBefore: { lte: new Date() } }], updatedAt: { lt: new Date(Date.now() - 2 * 60_000) } },
    select: { id: true, campaignId: true }, take: 500,
  });
  // sends of a paused campaign wait on purpose; resuming the campaign re-queues them
  const campaignIds = [...new Set(queued.map((o) => o.campaignId).filter((x): x is string => !!x))];
  const running = new Set((await db.campaign.findMany({ where: { id: { in: campaignIds }, status: "running" }, select: { id: true } })).map((c) => c.id));
  const lost = queued.filter((o) => !o.campaignId || running.has(o.campaignId));
  for (const o of lost) await jobs.send(o.id);
  // a process that died mid-send: we cannot know if Meta got it, so it is not retried
  const crashed = await db.outboundMessage.updateMany({
    where: { status: "sending", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    data: { status: "unknown", errorMessage: "The worker stopped while sending. Not retried, to avoid a duplicate." },
  });
  return { events: stale.length, sends: lost.length, unknown: crashed.count };
}

import type { PrismaClient } from "@prisma/client";
import { deleteObject } from "./storage";

const DAY = 86_400_000;

/** Daily purge per workspace settings. Unprocessed webhook events are never purged. */
export async function purgeExpired(db: PrismaClient, now = new Date()) {
  const orgs = await db.organization.findMany({ select: { id: true, messageRetentionDays: true, eventRetentionDays: true } });
  let messages = 0, events = 0, deliveries = 0;
  for (const o of orgs) {
    events += (await db.webhookEvent.deleteMany({ where: { orgId: o.id, processedAt: { not: null }, receivedAt: { lt: new Date(now.getTime() - o.eventRetentionDays * DAY) } } })).count;
    if (o.messageRetentionDays) {
      const cutoff = new Date(now.getTime() - o.messageRetentionDays * DAY);
      const media = await db.message.findMany({ where: { orgId: o.id, timestamp: { lt: cutoff }, mediaPath: { not: null } }, select: { mediaPath: true } });
      for (const m of media) await deleteObject(m.mediaPath!).catch(() => {});
      messages += (await db.message.deleteMany({ where: { orgId: o.id, timestamp: { lt: cutoff } } })).count;
    }
  }
  deliveries = (await db.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * DAY) } } })).count;
  return { messages, events, deliveries };
}

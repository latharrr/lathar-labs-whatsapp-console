import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Jobs } from "./jobs";

export const WEBHOOK_QUEUE = "webhook-events";
export const SEND_QUEUE = "sends";
export const MEDIA_QUEUE = "media";
export const AUTOMATION_QUEUE = "automation";
export const OUTHOOK_QUEUE = "outbound-webhooks";

let conn: IORedis | undefined;
export function redis(): IORedis {
  // maxRetriesPerRequest: null is required by BullMQ workers
  conn ??= new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });
  return conn;
}

const queues = new Map<string, Queue>();
export function queue(name: string): Queue {
  let q = queues.get(name);
  if (!q) queues.set(name, (q = new Queue(name, { connection: redis() })));
  return q;
}
export const webhookQueue = () => queue(WEBHOOK_QUEUE);

/**
 * jobId = event id, so a duplicate enqueue while a job is waiting or running is a no-op.
 * A finished job is kept for a while and would also swallow a new add with the same id,
 * so it is removed first: otherwise Replay and the sweeper silently do nothing.
 */
export async function enqueueWebhookEvent(eventId: string) {
  const old = await webhookQueue().getJob(eventId);
  if (old && ((await old.isCompleted()) || (await old.isFailed()))) await old.remove();
  return webhookQueue().add("process", { eventId }, {
    jobId: eventId,
    attempts: 8,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

const keep = { removeOnComplete: 1000, removeOnFail: 5000 };

/**
 * BullMQ-backed jobs. Send jobs carry no fixed jobId on purpose: a send can be re-queued after a pause or
 * a backoff, and the database claim (status queued -> sending) is what makes each send happen once.
 */
export const bullJobs: Jobs = {
  async send(id, delayMs = 0) { await queue(SEND_QUEUE).add("send", { id }, { delay: delayMs, ...keep }); },
  async media(id) { await queue(MEDIA_QUEUE).add("media", { id }, { jobId: `media-${id}`, attempts: 5, backoff: { type: "exponential", delay: 10_000 }, ...keep }); },
  async automation(id) { await queue(AUTOMATION_QUEUE).add("inbound", { id }, { jobId: `auto-${id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 }, ...keep }); },
  async deliver(id, delayMs = 0) { await queue(OUTHOOK_QUEUE).add("deliver", { id }, { delay: delayMs, ...keep }); },
  async publish(orgId, event) { await redis().publish(`rt:${orgId}`, JSON.stringify(event)); },
};

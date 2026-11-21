import { afterAll, expect, it } from "vitest";
import { QueueEvents, Worker } from "bullmq";
import { enqueueWebhookEvent, redis, WEBHOOK_QUEUE, webhookQueue } from "@ll/db/src/queue";

// Real Redis: a replayed or swept event must get a fresh job even though its old one finished.
const worker = new Worker(WEBHOOK_QUEUE, async () => "test", { connection: redis() });
const events = new QueueEvents(WEBHOOK_QUEUE, { connection: redis() });
afterAll(async () => { await worker.close(); await events.close(); });

it("re-enqueues an event whose previous job already finished, but not one still waiting", async () => {
  const id = `test-requeue-${Date.now()}`;
  // add() returns a locally built job even when it drops a duplicate, so compare what Redis stored
  const stored = async (jobId: string) => (await webhookQueue().getJob(jobId))!;
  await (await enqueueWebhookEvent(id)).waitUntilFinished(events, 10_000);
  const first = await stored(id);
  await new Promise((ok) => setTimeout(ok, 5));
  await enqueueWebhookEvent(id);
  expect((await stored(id)).timestamp).toBeGreaterThan(first.timestamp); // before the fix: the old finished job stayed
  await (await stored(id)).waitUntilFinished(events, 10_000);

  await webhookQueue().pause();
  try {
    await enqueueWebhookEvent(`${id}-b`);
    const waiting = await stored(`${id}-b`);
    await new Promise((ok) => setTimeout(ok, 5));
    await enqueueWebhookEvent(`${id}-b`);
    expect((await stored(`${id}-b`)).timestamp).toBe(waiting.timestamp);
    await waiting.remove();
  } finally {
    await webhookQueue().resume();
  }
});

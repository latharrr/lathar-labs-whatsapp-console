/** Background worker: webhook processing, sends, media, automations, outbound webhooks, campaigns, retention. */
import { Worker } from "bullmq";
import { prisma } from "@ll/db";
import { handleInboundAutomation } from "@ll/db/src/automation";
import { dispatchTick, DISPATCH_MS } from "@ll/db/src/campaigns";
import { fetchInboundMedia } from "@ll/db/src/media";
import { deliver } from "@ll/db/src/outhooks";
import { processEvent } from "@ll/db/src/process";
import { AUTOMATION_QUEUE, bullJobs, enqueueWebhookEvent, MEDIA_QUEUE, OUTHOOK_QUEUE, redis, SEND_QUEUE, WEBHOOK_QUEUE } from "@ll/db/src/queue";
import { log } from "@ll/db/src/redact";
import { purgeExpired } from "@ll/db/src/retention";
import { performSend } from "@ll/db/src/send";
import { sweep } from "@ll/db/src/sweep";

const connection = redis();

/** Fixed one-second window per number. Returns ms to wait when the number is at its cap. */
async function rateLimit(phoneNumberId: string, perSecond: number) {
  const now = Date.now();
  const key = `rl:${phoneNumberId}:${Math.floor(now / 1000)}`;
  const n = await connection.incr(key);
  if (n === 1) await connection.pexpire(key, 2000);
  return n > perSecond ? 1000 - (now % 1000) + Math.floor(Math.random() * 50) : 0;
}

/** Only one worker process runs a periodic task at a time. */
async function withLock(name: string, ttlMs: number, fn: () => Promise<unknown>) {
  const ok = await connection.set(`lock:${name}`, String(process.pid), "PX", ttlMs, "NX");
  if (!ok) return;
  try { await fn(); } finally { await connection.del(`lock:${name}`); }
}

const workers = [
  new Worker(WEBHOOK_QUEUE, (job) => processEvent(prisma, job.data.eventId, bullJobs), { connection, concurrency: 5 }),
  new Worker(SEND_QUEUE, (job) => performSend(prisma, bullJobs, job.data.id, { rateLimit }), { connection, concurrency: 10 }),
  new Worker(MEDIA_QUEUE, async (job) => {
    const r = await fetchInboundMedia(prisma, job.data.id);
    const m = await prisma.message.findUnique({ where: { id: job.data.id }, select: { orgId: true, conversationId: true } });
    if (m) await bullJobs.publish(m.orgId, { type: "media", conversationId: m.conversationId });
    return r;
  }, { connection, concurrency: 3 }),
  new Worker(AUTOMATION_QUEUE, (job) => handleInboundAutomation({ db: prisma, jobs: bullJobs }, job.data.id), { connection, concurrency: 5 }),
  new Worker(OUTHOOK_QUEUE, async (job) => {
    const delay = await deliver(prisma, job.data.id);
    if (delay !== null) await bullJobs.deliver(job.data.id, delay);
  }, { connection, concurrency: 5 }),
];
for (const w of workers) w.on("failed", (job, err) => log.error(`${w.name} job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));

async function runSweep() {
  const r = await sweep(prisma, bullJobs, enqueueWebhookEvent);
  if (r.events || r.sends || r.unknown) log.info(`sweeper: ${r.events} events, ${r.sends} sends re-queued, ${r.unknown} marked unknown`);
}

const timers = [
  setInterval(() => withLock("dispatch", DISPATCH_MS * 2, () => dispatchTick(prisma, bullJobs)).catch((e) => log.error("dispatch", e)), DISPATCH_MS),
  setInterval(() => withLock("sweep", 60_000, runSweep).catch((e) => log.error("sweep", e)), 30_000),
  setInterval(() => withLock("retention", 10 * 60_000, async () => {
    const last = Number(await connection.get("retention:last")) || 0;
    if (Date.now() - last < 24 * 3_600_000) return;
    log.info("retention purge", await purgeExpired(prisma));
    await connection.set("retention:last", String(Date.now()));
  }).catch((e) => log.error("retention", e)), 10 * 60_000),
];

async function shutdown() {
  timers.forEach(clearInterval);
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
log.info(`worker running: ${workers.map((w) => w.name).join(", ")}`);

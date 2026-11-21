/** Regression tests for gaps found in the Nov 2026 review of the high-risk paths. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, Prisma } from "@ll/db";
import { dispatchTick, launchCampaign, setCampaignState } from "@ll/db/src/campaigns";
import { storeWebhook } from "@ll/db/src/ingest";
import { recordingJobs } from "@ll/db/src/jobs";
import { applyOptOut } from "@ll/db/src/optout";
import { hashPassword, verifyPassword } from "@ll/db/src/password";
import { enqueueSend, MAX_ATTEMPTS, performSend, type SendInput } from "@ll/db/src/send";
import { sweep } from "@ll/db/src/sweep";
import { act } from "../../web/lib/server";
import { makeContact, makeOrg, metaError, mockGraph, reset } from "./helpers";

afterAll(() => prisma.$disconnect());
const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = realFetch; });

async function setup(opts: { optIn?: boolean; windowOpen?: boolean } = {}) {
  await reset();
  const w = await makeOrg("Org", { fixture: false });
  const c = await makeContact(w.org.id, w.phone.id, "15550003001", { optIn: opts.optIn ?? true, windowOpen: opts.windowOpen ?? true });
  const jobs = recordingJobs();
  const input = (over: Partial<SendInput> = {}): SendInput => ({
    orgId: w.org.id, phoneNumberId: w.phone.id, contactId: c.contact.id, kind: "text", category: "service", source: "inbox",
    payload: { type: "text", text: { body: "hi" }, _preview: "hi" }, idempotencyKey: `k-${Math.random()}`, ...over,
  });
  return { ...w, ...c, jobs, input };
}

const ready = (id: string) => prisma.outboundMessage.update({ where: { id }, data: { notBefore: null } });

describe("waiting does not use up the retry budget", () => {
  it("a send throttled more times than MAX_ATTEMPTS still retries a temporary Meta error", async () => {
    const s = await setup();
    const o = await enqueueSend(prisma, s.jobs, s.input());
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
      expect(await performSend(prisma, s.jobs, o.id, { rateLimit: async () => 50 })).toBe("throttled");
      await ready(o.id);
    }
    mockGraph([metaError(503, 131016, "unavailable")]);
    expect(await performSend(prisma, s.jobs, o.id)).toBe("retry");
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: o.id } })).attempts).toBe(1);
  });
});

describe("sweeper (lost and crashed jobs)", () => {
  it("a send stuck mid-request is marked unknown and never sent again", async () => {
    const s = await setup();
    const calls = mockGraph([]);
    const o = await enqueueSend(prisma, s.jobs, s.input());
    await prisma.$executeRaw`UPDATE "OutboundMessage" SET status = 'sending', "updatedAt" = now() - interval '11 minutes' WHERE id = ${o.id}`;
    await sweep(prisma, s.jobs, async () => {});
    const row = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: o.id } });
    expect(row.status).toBe("unknown");
    expect(await performSend(prisma, s.jobs, o.id)).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("a lost queued send is re-queued, and the send-time check still blocks it after an opt-out", async () => {
    const s = await setup();
    const calls = mockGraph([]);
    const o = await enqueueSend(prisma, s.jobs, s.input({ kind: "template", category: "utility", source: "automation", payload: { type: "template", template: { name: "t", language: { code: "en" } } } }));
    await prisma.$executeRaw`UPDATE "OutboundMessage" SET "updatedAt" = now() - interval '5 minutes' WHERE id = ${o.id}`;
    const before = s.jobs.of("send").length;
    await sweep(prisma, s.jobs, async () => {});
    expect(s.jobs.of("send").length).toBe(before + 1);
    // opted out between the lost job and the sweeper's job: the queued row is cancelled and never sent
    await applyOptOut(prisma, { orgId: s.org.id, contactId: s.contact.id, source: "test" });
    expect(await performSend(prisma, s.jobs, o.id)).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("does not keep re-queueing sends of a paused campaign", async () => {
    const s = await setup();
    const c = await prisma.campaign.create({ data: { orgId: s.org.id, name: "c", phoneNumberId: s.phone.id, status: "running", variants: [] } });
    await prisma.outboundMessage.create({ data: { orgId: s.org.id, phoneNumberId: s.phone.id, contactId: s.contact.id, kind: "template", category: "marketing", source: "campaign", campaignId: c.id, payload: {}, idempotencyKey: "paused-1" } });
    await prisma.campaign.update({ where: { id: c.id }, data: { status: "paused" } });
    await prisma.$executeRaw`UPDATE "OutboundMessage" SET "updatedAt" = now() - interval '5 minutes' WHERE "campaignId" = ${c.id}`;
    const before = s.jobs.of("send").length;
    await sweep(prisma, s.jobs, async () => {});
    expect(s.jobs.of("send").length).toBe(before);
    await setCampaignState(prisma, s.jobs, s.org.id, c.id, "resume");
    expect(s.jobs.of("send").length).toBeGreaterThan(before); // resume is what re-queues them
  });

  it("re-enqueues webhook events stored while the queue was down", async () => {
    await reset();
    const ev = await storeWebhook(prisma, JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
    await prisma.$executeRaw`UPDATE "WebhookEvent" SET "receivedAt" = now() - interval '2 minutes' WHERE id = ${ev.id}`;
    const seen: string[] = [];
    await sweep(prisma, recordingJobs(), async (id) => { seen.push(id); });
    expect(seen).toEqual([ev.id]);
  });
});

describe("webhook batches that span workspaces", () => {
  it("a batch naming two workspaces' accounts is visible to neither in the event log", async () => {
    await reset();
    const a = await makeOrg("A", { fixture: true });
    const b = await makeOrg("B", { fixture: true });
    const entry = (id: string) => ({ id, changes: [{ field: "messages", value: { messaging_product: "whatsapp" } }] });
    const mixed = await storeWebhook(prisma, JSON.stringify({ object: "whatsapp_business_account", entry: [entry(a.waba.metaWabaId), entry(b.waba.metaWabaId)] }));
    const same = await storeWebhook(prisma, JSON.stringify({ object: "whatsapp_business_account", entry: [entry(a.waba.metaWabaId), entry(a.waba.metaWabaId)] }));
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: mixed.id } })).orgId).toBeNull();
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: same.id } })).orgId).toBe(a.org.id);
  });
});

describe("error messages shown to people", () => {
  it("database errors never reach the form; our own messages do", async () => {
    const init = new Prisma.PrismaClientInitializationError("Can't reach database server at `db.internal:5432`", "6.0.0");
    expect((await act(async () => { throw init; })).error).toBe("Something went wrong. Nothing was changed.");
    const validation = new Prisma.PrismaClientValidationError("Invalid `prisma.contact.update()` invocation: secret column", { clientVersion: "6.0.0" });
    expect((await act(async () => { throw validation; })).error).toBe("Something went wrong. Nothing was changed.");
    expect((await act(async () => { throw new Error("Campaign not found."); })).error).toBe("Campaign not found.");
  });
});

describe("sign-in timing", () => {
  it("an unknown email costs as much hashing work as a wrong password", async () => {
    const stored = await hashPassword("correct horse battery");
    const time = async (h: string | null) => { const t = performance.now(); for (let i = 0; i < 3; i++) await verifyPassword("wrong password!", h); return performance.now() - t; };
    await time(stored); // warm up
    const known = await time(stored);
    const unknown = await time(null);
    expect(unknown).toBeGreaterThan(known * 0.5);
  });
});

describe("scheduled campaigns", () => {
  it("send nothing before their time, then start on the first tick after it", async () => {
    await reset();
    const w = await makeOrg("Sched", { fixture: true });
    await makeContact(w.org.id, w.phone.id, "15550004001", { optIn: true });
    const t = await prisma.template.create({ data: { wabaId: w.waba.id, metaTemplateId: "t-s", name: "promo", language: "en", category: "MARKETING", status: "APPROVED", components: [{ type: "BODY", text: "Hi" }] } });
    const at = new Date(Date.now() + 3_600_000);
    const c = await prisma.campaign.create({ data: { orgId: w.org.id, phoneNumberId: w.phone.id, name: "Later", throttlePerMinute: 600, scheduledAt: at, variants: [{ templateId: t.id, weight: 1, variables: {} }] } });
    const jobs = recordingJobs();
    await launchCampaign(prisma, w.org.id, c.id);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("scheduled");
    await dispatchTick(prisma, jobs, new Date(at.getTime() - 60_000));
    expect(await prisma.outboundMessage.count({ where: { campaignId: c.id } })).toBe(0);
    await dispatchTick(prisma, jobs, new Date(at.getTime() + 1000));
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("running");
    expect(await prisma.outboundMessage.count({ where: { campaignId: c.id } })).toBe(1);
  });
});

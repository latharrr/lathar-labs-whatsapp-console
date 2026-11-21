/** Outbox safeguards: window, opt-in/out, suppression right before send, duplicates, retries, cancellation, throttling. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@ll/db";
import { dispatchTick, launchCampaign, retryFailed, setCampaignState } from "@ll/db/src/campaigns";
import { recordingJobs } from "@ll/db/src/jobs";
import { applyOptOut } from "@ll/db/src/optout";
import { enqueueSend, MAX_ATTEMPTS, performSend, SendRefused, type SendInput } from "@ll/db/src/send";
import { makeContact, makeOrg, metaError, mockGraph, ok, reset } from "./helpers";

afterAll(() => prisma.$disconnect());

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = realFetch; });

async function setup(opts: { fixture?: boolean; optIn?: boolean; windowOpen?: boolean; limit?: string } = {}) {
  await reset();
  const w = await makeOrg("Org", { fixture: opts.fixture ?? false, limit: opts.limit });
  const c = await makeContact(w.org.id, w.phone.id, "15550002001", { optIn: opts.optIn, windowOpen: opts.windowOpen });
  const jobs = recordingJobs();
  const input = (over: Partial<SendInput> = {}): SendInput => ({
    orgId: w.org.id, phoneNumberId: w.phone.id, contactId: c.contact.id, kind: "text", category: "service", source: "inbox",
    payload: { type: "text", text: { body: "hello" }, _preview: "hello" }, idempotencyKey: `k-${Math.random()}`, ...over,
  });
  const template = (over: Partial<SendInput> = {}) => input({ kind: "template", category: "marketing", payload: { type: "template", template: { name: "promo", language: { code: "en" } }, _preview: "promo" }, ...over });
  return { ...w, ...c, jobs, input, template };
}

describe("24-hour service window (server-side)", () => {
  it("refuses free-form text when the window is closed, allows templates", async () => {
    const s = await setup({ optIn: true, windowOpen: false });
    await expect(enqueueSend(prisma, s.jobs, s.input())).rejects.toThrow("window is closed");
    await expect(enqueueSend(prisma, s.jobs, s.template({ category: "utility" }))).resolves.toBeTruthy();
  });

  it("re-checks at send time: a window that closed while queued blocks the send, and Meta is never called", async () => {
    const s = await setup({ windowOpen: true });
    const calls = mockGraph([]);
    const o = await enqueueSend(prisma, s.jobs, s.input());
    await prisma.conversation.update({ where: { id: s.conv.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } });
    expect(await performSend(prisma, s.jobs, o.id)).toBe("blocked");
    expect(calls).toHaveLength(0);
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: o.id } })).errorMessage).toContain("window is closed");
  });
});

describe("marketing opt-in and opt-out", () => {
  it("marketing needs a recorded opt-in", async () => {
    const s = await setup({ optIn: false });
    await expect(enqueueSend(prisma, s.jobs, s.template())).rejects.toThrow("no recorded marketing opt-in");
  });

  it("an opt-out cancels queued sends at once, and a job already in the queue cannot slip through", async () => {
    const s = await setup({ optIn: true, windowOpen: true });
    const calls = mockGraph([]);
    const o = await enqueueSend(prisma, s.jobs, s.template());
    await applyOptOut(prisma, { orgId: s.org.id, contactId: s.contact.id, source: "test" });
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("cancelled");
    expect(await performSend(prisma, s.jobs, o.id)).toBe("skipped"); // the stale job from Redis
    expect(calls).toHaveLength(0);
  });

  it("suppression is checked again before a retry", async () => {
    const s = await setup({ optIn: true, windowOpen: true });
    const calls = mockGraph([metaError(429, 130429, "rate limit")]);
    const o = await enqueueSend(prisma, s.jobs, s.template());
    expect(await performSend(prisma, s.jobs, o.id)).toBe("retry");
    await prisma.contact.update({ where: { id: s.contact.id }, data: { optInStatus: "opted_out" } });
    await prisma.outboundMessage.update({ where: { id: o.id }, data: { notBefore: null } });
    expect(await performSend(prisma, s.jobs, o.id)).toBe("blocked");
    expect(calls).toHaveLength(1);
  });

  it("Meta error 131050 records an opt-out", async () => {
    const s = await setup({ optIn: true, windowOpen: true });
    mockGraph([metaError(400, 131050, "user stopped marketing")]);
    const o = await enqueueSend(prisma, s.jobs, s.template());
    expect(await performSend(prisma, s.jobs, o.id)).toBe("failed");
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: s.contact.id } })).optInStatus).toBe("opted_out");
  });

  it("blocked contacts get nothing", async () => {
    const s = await setup({ windowOpen: true });
    await prisma.contact.update({ where: { id: s.contact.id }, data: { blocked: true } });
    await expect(enqueueSend(prisma, s.jobs, s.input())).rejects.toBeInstanceOf(SendRefused);
  });
});

describe("delivery to Meta", () => {
  it("sends the right request and stores the message", async () => {
    const s = await setup({ windowOpen: true });
    const calls = mockGraph([ok("wamid.REAL1")]);
    const o = await enqueueSend(prisma, s.jobs, s.input());
    expect(await performSend(prisma, s.jobs, o.id)).toBe("sent");
    expect(calls[0].url).toBe(`https://graph.test.invalid/v26.0/${s.phone.metaPhoneNumberId}/messages`);
    expect(calls[0].init.headers.Authorization).toMatch(/^Bearer EAA/);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "15550002001", type: "text", text: { body: "hello" } });
    const m = await prisma.message.findUniqueOrThrow({ where: { wamid: "wamid.REAL1" } });
    expect([m.direction, m.outboundId, m.isTest, m.orgId]).toEqual(["OUT", o.id, false, s.org.id]);
  });

  it("a test account never calls Meta", async () => {
    const s = await setup({ fixture: true, windowOpen: true });
    const calls = mockGraph([]);
    const o = await enqueueSend(prisma, s.jobs, s.input());
    expect(await performSend(prisma, s.jobs, o.id)).toBe("sent");
    expect(calls).toHaveLength(0);
    expect((await prisma.message.findFirstOrThrow({ where: { outboundId: o.id } })).isTest).toBe(true);
  });
});

describe("duplicates", () => {
  it("the same idempotency key makes one row; two jobs for one row send once", async () => {
    const s = await setup({ windowOpen: true });
    const calls = mockGraph([ok("wamid.D1"), ok("wamid.D2")]);
    const a = await enqueueSend(prisma, s.jobs, s.input({ idempotencyKey: "same" }));
    const b = await enqueueSend(prisma, s.jobs, s.input({ idempotencyKey: "same" }));
    expect(a.id).toBe(b.id);
    const results = await Promise.all([performSend(prisma, s.jobs, a.id), performSend(prisma, s.jobs, a.id)]);
    expect(results.sort()).toEqual(["sent", "skipped"]);
    expect(calls).toHaveLength(1);
  });
});

describe("retries", () => {
  it("retries temporary errors with backoff, then gives up", async () => {
    const s = await setup({ windowOpen: true });
    mockGraph(Array.from({ length: MAX_ATTEMPTS + 1 }, () => metaError(503, 131016, "unavailable")));
    const o = await enqueueSend(prisma, s.jobs, s.input());
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      expect(await performSend(prisma, s.jobs, o.id)).toBe("retry");
      const row = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: o.id } });
      expect(row.notBefore!.getTime()).toBeGreaterThan(Date.now());
      await prisma.outboundMessage.update({ where: { id: o.id }, data: { notBefore: null } });
    }
    expect(await performSend(prisma, s.jobs, o.id)).toBe("failed");
  });

  it("does not retry final errors", async () => {
    const s = await setup({ windowOpen: true });
    mockGraph([metaError(400, 131026, "undeliverable")]);
    const o = await enqueueSend(prisma, s.jobs, s.input());
    expect(await performSend(prisma, s.jobs, o.id)).toBe("failed");
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: o.id } })).errorCode).toBe(131026);
  });

  it("a timeout after the request left is marked unknown, never retried", async () => {
    const s = await setup({ windowOpen: true });
    const calls = mockGraph([Object.assign(new Error("timeout"), { name: "TimeoutError" })]);
    const o = await enqueueSend(prisma, s.jobs, s.input());
    expect(await performSend(prisma, s.jobs, o.id)).toBe("unknown");
    expect(await performSend(prisma, s.jobs, o.id)).toBe("skipped");
    expect(calls).toHaveLength(1);
  });

  it("a refused connection is safe to retry", async () => {
    const s = await setup({ windowOpen: true });
    mockGraph([Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })]);
    const o = await enqueueSend(prisma, s.jobs, s.input());
    expect(await performSend(prisma, s.jobs, o.id)).toBe("retry");
  });
});

describe("limits", () => {
  it("waits when the number's send rate is used up", async () => {
    const s = await setup({ windowOpen: true });
    const o = await enqueueSend(prisma, s.jobs, s.input());
    expect(await performSend(prisma, s.jobs, o.id, { rateLimit: async () => 400 })).toBe("throttled");
    expect(s.jobs.of("send").at(-1)).toEqual([o.id, 400]);
  });

  it("holds business-initiated templates once the messaging limit is reached", async () => {
    const s = await setup({ fixture: true, optIn: true, limit: "TIER_1" });
    const other = await prisma.contact.create({ data: { orgId: s.org.id, waId: "15550002999", optInStatus: "opted_in" } });
    await prisma.outboundMessage.create({ data: { orgId: s.org.id, phoneNumberId: s.phone.id, contactId: other.id, kind: "template", category: "marketing", source: "campaign", payload: {}, idempotencyKey: "used", status: "sent", sentAt: new Date() } });
    const o = await enqueueSend(prisma, s.jobs, s.template());
    expect(await performSend(prisma, s.jobs, o.id)).toBe("held");
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: o.id } })).errorMessage).toContain("messaging limit");
  });
});

describe("campaigns", () => {
  async function campaign(size: number, throttlePerMinute: number) {
    const s = await setup({ fixture: true, optIn: true });
    const t = await prisma.template.create({ data: { wabaId: s.waba.id, metaTemplateId: "t1", name: "promo", language: "en", category: "MARKETING", status: "APPROVED", components: [{ type: "BODY", text: "Hi {{1}}", example: { body_text: [["Asha"]] } }] } });
    for (let i = 0; i < size; i++) await prisma.contact.create({ data: { orgId: s.org.id, waId: `1555000${String(3000 + i)}`, name: `C${i}`, optInStatus: "opted_in" } });
    await prisma.contact.create({ data: { orgId: s.org.id, waId: "15550009001", optInStatus: "unknown" } });
    await prisma.contact.create({ data: { orgId: s.org.id, waId: "15550009002", optInStatus: "opted_out" } });
    const c = await prisma.campaign.create({ data: { orgId: s.org.id, phoneNumberId: s.phone.id, name: "Test", throttlePerMinute, variants: [{ templateId: t.id, weight: 1, variables: { "body.1": "field:name" } }] } });
    return { s, c };
  }

  it("only opted-in contacts are queued; the rest are recorded as skipped", async () => {
    const { s, c } = await campaign(3, 600);
    const pre = await launchCampaign(prisma, s.org.id, c.id);
    expect(pre.skipped).toEqual({ no_opt_in: 1, opted_out: 1 });
    expect(pre.eligible).toBe(4); // 3 + the setup contact
    expect(await prisma.campaignRecipient.count({ where: { campaignId: c.id, status: "skipped" } })).toBe(2);
  });

  it("throttles: 60 a minute queues 5 per 5-second tick and counts sends in flight", async () => {
    const { s, c } = await campaign(20, 60);
    await launchCampaign(prisma, s.org.id, c.id);
    expect(await dispatchTick(prisma, s.jobs)).toBe(5);
    expect(await dispatchTick(prisma, s.jobs)).toBe(0); // 5 still queued
    for (const [id] of s.jobs.of("send")) await performSend(prisma, s.jobs, id as string);
    expect(await dispatchTick(prisma, s.jobs)).toBe(5);
  });

  it("pause holds queued sends, resume re-queues them, cancel stops everything", async () => {
    const { s, c } = await campaign(6, 600);
    await launchCampaign(prisma, s.org.id, c.id);
    await dispatchTick(prisma, s.jobs);
    const [[first]] = s.jobs.of("send") as [string][];
    await setCampaignState(prisma, s.jobs, s.org.id, c.id, "pause");
    expect(await performSend(prisma, s.jobs, first)).toBe("held");
    const before = s.jobs.of("send").length;
    await setCampaignState(prisma, s.jobs, s.org.id, c.id, "resume");
    expect(s.jobs.of("send").length).toBeGreaterThan(before);
    await setCampaignState(prisma, s.jobs, s.org.id, c.id, "cancel");
    expect(await performSend(prisma, s.jobs, first)).toBe("skipped");
    expect(await prisma.outboundMessage.count({ where: { campaignId: c.id, status: "queued" } })).toBe(0);
    expect(await prisma.campaignRecipient.count({ where: { campaignId: c.id, status: { in: ["pending", "queued"] } } })).toBe(0);
  });

  it("retry-failed only retries temporary errors", async () => {
    const { s, c } = await campaign(2, 600);
    await launchCampaign(prisma, s.org.id, c.id);
    const rs = await prisma.campaignRecipient.findMany({ where: { campaignId: c.id, status: "pending" }, take: 2 });
    await prisma.campaignRecipient.update({ where: { id: rs[0].id }, data: { status: "failed", errorCode: 131016 } });
    await prisma.campaignRecipient.update({ where: { id: rs[1].id }, data: { status: "failed", errorCode: 131026 } });
    expect(await retryFailed(prisma, s.org.id, c.id)).toEqual({ retried: 1, notRetryable: 1 });
    expect((await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: rs[0].id } })).attempt).toBe(1);
  });

  it("fills variables per contact and completes when done", async () => {
    const { s, c } = await campaign(1, 600);
    await launchCampaign(prisma, s.org.id, c.id);
    await dispatchTick(prisma, s.jobs);
    for (const [id] of s.jobs.of("send")) await performSend(prisma, s.jobs, id as string);
    const sent = await prisma.message.findMany({ where: { orgId: s.org.id, direction: "OUT" } });
    expect(sent.map((m) => m.body).sort()).toEqual(["Hi C0", "Hi Test 001"]);
    await dispatchTick(prisma, s.jobs);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("completed");
  });
});

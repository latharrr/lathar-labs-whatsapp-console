import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { prisma } from "@ll/db";
import { handleApiEvent, handleInboundAutomation, validateGraph, withinBusinessHours } from "@ll/db/src/automation";
import { aiReply } from "@ll/db/src/ai";
import { storeWebhook } from "@ll/db/src/ingest";
import { recordingJobs } from "@ll/db/src/jobs";
import { deliver, emit, signBody } from "@ll/db/src/outhooks";
import { processEvent } from "@ll/db/src/process";
import { encrypt } from "@ll/db";
import { makeContact, makeOrg, reset } from "./helpers";

afterAll(() => prisma.$disconnect());

async function setup() {
  await reset();
  const w = await makeOrg("Org", { fixture: true });
  const jobs = recordingJobs();
  let i = 0;
  const inbound = async (payload: object) => {
    i++;
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: w.waba.metaWabaId, changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: w.phone.metaPhoneNumberId },
      contacts: [{ wa_id: "15550004001", profile: { name: "Asha" } }],
      messages: [{ from: "15550004001", id: `wamid.IN.${i}.${Math.random()}`, timestamp: String(Math.floor(Date.now() / 1000)), ...payload }],
    } }] }] });
    const ev = await storeWebhook(prisma, raw);
    await processEvent(prisma, ev.id, jobs);
    return prisma.message.findFirstOrThrow({ where: { orgId: w.org.id, direction: "IN" }, orderBy: { createdAt: "desc" } });
  };
  const run = async (messageId: string, now?: Date) => {
    const r = await handleInboundAutomation({ db: prisma, jobs }, messageId, now);
    return r;
  };
  const outbound = () => prisma.outboundMessage.findMany({ where: { orgId: w.org.id }, orderBy: { createdAt: "asc" } });
  return { ...w, jobs, inbound, run, outbound };
}

describe("STOP and Not interested come before automations", () => {
  it("STOP opts the contact out and no automation job is queued", async () => {
    const s = await setup();
    await prisma.automation.create({ data: { orgId: s.org.id, name: "Echo", kind: "keyword", config: { keywords: ["stop"], reply: "should never send" } } });
    const m = await s.inbound({ type: "text", text: { body: "  Stop! " } });
    expect((await prisma.contact.findFirstOrThrow({ where: { orgId: s.org.id } })).optInStatus).toBe("opted_out");
    expect(s.jobs.of("automation")).toEqual([]);
    expect(await s.run(m.id)).toBe("suppressed"); // even if a job ran, it would do nothing
    expect(await s.outbound()).toHaveLength(0);
  });

  it("the marketing opt-out quick-reply button counts too", async () => {
    const s = await setup();
    await s.inbound({ type: "button", button: { text: "Stop promotions", payload: "Stop promotions" } });
    expect((await prisma.contact.findFirstOrThrow({ where: { orgId: s.org.id } })).optInStatus).toBe("opted_out");
  });

  it("'not interested' opts out; START opts back in with the message as proof", async () => {
    const s = await setup();
    await s.inbound({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "x", title: "Not interested" } } });
    expect((await prisma.contact.findFirstOrThrow({ where: { orgId: s.org.id } })).optInStatus).toBe("opted_out");
    await s.inbound({ type: "text", text: { body: "START" } });
    const c = await prisma.contact.findFirstOrThrow({ where: { orgId: s.org.id } });
    expect([c.optInStatus, c.optInSource]).toEqual(["opted_in", "keyword"]);
    expect(c.optInProof).toMatch(/^WhatsApp message wamid\.IN/);
  });

  it("the user_preferences webhook 'stop' opts out; 'resume' does not opt in", async () => {
    const s = await setup();
    await s.inbound({ type: "text", text: { body: "hi" } });
    const send = async (value: string) => {
      const ev = await storeWebhook(prisma, JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: s.waba.metaWabaId, changes: [{ field: "user_preferences", value: { user_preferences: [{ wa_id: "15550004001", category: "marketing_messages", value, timestamp: 1800000000 }] } }] }] }));
      await processEvent(prisma, ev.id, s.jobs);
    };
    await send("stop");
    expect((await prisma.contact.findFirstOrThrow({ where: { orgId: s.org.id } })).optInStatus).toBe("opted_out");
    await send("resume");
    expect((await prisma.contact.findFirstOrThrow({ where: { orgId: s.org.id } })).optInStatus).toBe("opted_out");
  });
});

describe("keyword, welcome and away automations", () => {
  it("a keyword reply goes through the outbox", async () => {
    const s = await setup();
    await prisma.automation.create({ data: { orgId: s.org.id, name: "Hours", kind: "keyword", config: { keywords: ["hours"], match: "contains", reply: "We open at 9, {{name}}." } } });
    const m = await s.inbound({ type: "text", text: { body: "What are your hours?" } });
    expect(s.jobs.of("automation")).toEqual([[m.id]]);
    expect(await s.run(m.id)).toBe("keyword");
    const [o] = await s.outbound();
    expect((o.payload as { text: { body: string } }).text.body).toBe("We open at 9, Asha.");
    expect(o.source).toBe("automation");
  });

  it("welcome fires on the first message only; away fires outside hours once per 12h", async () => {
    const s = await setup();
    await prisma.organization.update({ where: { id: s.org.id }, data: { businessHours: { mon: [["09:00", "18:00"]] } } });
    await prisma.automation.create({ data: { orgId: s.org.id, name: "Welcome", kind: "welcome", config: { reply: "Welcome!" } } });
    await prisma.automation.create({ data: { orgId: s.org.id, name: "Away", kind: "away", config: { reply: "We're closed." } } });
    const sunday = new Date("2026-11-22T10:00:00+05:30");
    const m1 = await s.inbound({ type: "text", text: { body: "hi" } });
    expect(await s.run(m1.id, sunday)).toBe("welcome");
    const m2 = await s.inbound({ type: "text", text: { body: "hello?" } });
    expect(await s.run(m2.id, sunday)).toBe("away");
    const m3 = await s.inbound({ type: "text", text: { body: "anyone?" } });
    expect(await s.run(m3.id, sunday)).toBe("none");
  });

  it("business hours use the workspace timezone", () => {
    const hours = { fri: [["09:00", "18:00"]] };
    expect(withinBusinessHours(hours, "Asia/Kolkata", new Date("2026-11-20T04:00:00Z"))).toBe(true); // 09:30 IST
    expect(withinBusinessHours(hours, "Asia/Kolkata", new Date("2026-11-20T13:00:00Z"))).toBe(false); // 18:30 IST
    expect(withinBusinessHours(null, "Asia/Kolkata")).toBe(true);
  });
});

describe("flows", () => {
  const graph = {
    start: "ask",
    nodes: {
      ask: { type: "buttons", text: "Sales or support?", buttons: [{ id: "sales", title: "Sales", next: "save" }, { id: "support", title: "Support", next: "human" }] },
      save: { type: "set_attribute", key: "interest", value: "sales", next: "check" },
      check: { type: "branch", source: "attribute", key: "interest", op: "equals", value: "sales", yes: "thanks", no: "human" },
      thanks: { type: "message", text: "Thanks {{name}}, a sales person will write soon.", next: "end" },
      human: { type: "assign", next: "end" },
      end: { type: "end" },
    },
  };

  it("validates graphs", () => {
    expect(validateGraph(graph as never)).toEqual([]);
    expect(validateGraph({ start: "x", nodes: { a: { type: "message", text: "", next: "zz" } } } as never)).toEqual(
      ["The start node does not exist.", "Node a points to a missing node zz.", "Node a has no text."]);
  });

  it("buttons wait for a reply, then branch, set an attribute and reply", async () => {
    const s = await setup();
    const flow = await prisma.flow.create({ data: { orgId: s.org.id, name: "Triage", graph } });
    await prisma.automation.create({ data: { orgId: s.org.id, name: "Menu", kind: "keyword", flowId: flow.id, config: { keywords: ["menu"] } } });
    const m1 = await s.inbound({ type: "text", text: { body: "menu" } });
    expect(await s.run(m1.id)).toBe("waiting");
    const m2 = await s.inbound({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "sales", title: "Sales" } } });
    expect(await s.run(m2.id)).toBe("done");
    const out = await s.outbound();
    expect(out.map((o) => o.kind)).toEqual(["interactive", "text"]);
    expect((out[1].payload as { text: { body: string } }).text.body).toBe("Thanks Asha, a sales person will write soon.");
    expect((await prisma.contactAttribute.findFirstOrThrow({ where: { key: "interest" } })).value).toBe("sales");
  });

  it("the AI node replies with guardrails and hands off when unsure", async () => {
    const fake = (text: string, stop = "end_turn") => ({ beta: { messages: { create: async () => ({ stop_reason: stop, content: [{ type: "text", text }] }) } } }) as never;
    expect(await aiReply({ instructions: "We sell tea.", history: [{ role: "customer", text: "Do you sell tea?" }] }, fake("Yes, we do."))).toEqual({ reply: "Yes, we do." });
    expect(await aiReply({ instructions: "x", history: [{ role: "customer", text: "what is the price?" }] }, fake("HANDOFF"))).toHaveProperty("handoff");
    expect(await aiReply({ instructions: "x", history: [{ role: "customer", text: "hi" }] }, fake("", "refusal"))).toHaveProperty("handoff");
    let called = false;
    const spy = { beta: { messages: { create: async () => { called = true; return {}; } } } } as never;
    expect(await aiReply({ instructions: "x", history: [{ role: "customer", text: "I want a human" }] }, spy)).toEqual({ handoff: "customer asked for a person" });
    expect(called).toBe(false);
    expect(await aiReply({ instructions: "x", history: [{ role: "customer", text: "hi" }] })).toEqual({ handoff: "AI replies are off" });
  });
});

describe("API events", () => {
  it("an event automation sends a utility template with values from the event", async () => {
    const s = await setup();
    const t = await prisma.template.create({ data: { wabaId: s.waba.id, metaTemplateId: "o1", name: "order_update", language: "en", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "Order {{1}} is confirmed", example: { body_text: [["123"]] } }] } });
    await prisma.automation.create({ data: { orgId: s.org.id, name: "Orders", kind: "event", config: { event: "order.placed", templateId: t.id, variables: { "body.1": "data:orderId" } } } });
    const r = await handleApiEvent({ db: prisma, jobs: s.jobs }, s.org.id, { name: "order.placed", phone: "+15550004001", data: { orderId: "A-77" }, idempotencyKey: "ord-77" });
    expect(r.results).toEqual([{ automation: expect.any(String), outcome: "queued" }]);
    const again = await handleApiEvent({ db: prisma, jobs: s.jobs }, s.org.id, { name: "order.placed", phone: "+15550004001", data: { orderId: "A-77" }, idempotencyKey: "ord-77" });
    expect(again.results[0].outcome).toBe("queued");
    const out = await s.outbound();
    expect(out).toHaveLength(1); // same idempotency key, one send
    expect(out[0].payload).toMatchObject({ _preview: "Order A-77 is confirmed", template: { name: "order_update" } });
  });
});

describe("outbound webhooks", () => {
  it("delivers signed events and retries failures", async () => {
    const s = await setup();
    process.env.OUTBOUND_ALLOW_PRIVATE = "1";
    const seen: { sig?: string; body: string }[] = [];
    let status = 500;
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => { seen.push({ sig: req.headers["x-ll-signature-256"] as string, body }); res.writeHead(status).end(); });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const hook = await prisma.outboundWebhook.create({ data: { orgId: s.org.id, name: "n8n", url: `http://127.0.0.1:${port}/hook`, secretEnc: encrypt("whsec_test"), events: ["message.received"] } });
    expect(await emit(prisma, s.jobs, s.org.id, "message.received", { text: "hi" })).toBe(1);
    expect(await emit(prisma, s.jobs, s.org.id, "template.status", {})).toBe(0); // not subscribed
    const [[id]] = s.jobs.of("deliver") as [string][];
    expect(await deliver(prisma, id)).toBeGreaterThan(0); // 500 -> retry later
    status = 200;
    expect(await deliver(prisma, id)).toBeNull();
    expect(seen[1].sig).toBe(signBody("whsec_test", seen[1].body));
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } })).status).toBe("ok");
    server.close();
    delete process.env.OUTBOUND_ALLOW_PRIVATE;
    await prisma.outboundWebhook.update({ where: { id: hook.id }, data: { url: `http://127.0.0.1:${port}/hook` } });
    const d2 = await prisma.webhookDelivery.create({ data: { webhookId: hook.id, event: "message.received", payload: {} } });
    expect(await deliver(prisma, d2.id)).toBeGreaterThan(0); // blocked as private now, recorded as an error
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d2.id } })).error).toContain("private");
  });
});

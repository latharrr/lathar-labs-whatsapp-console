import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, sign, verifySignature, isWindowOpen, encrypt, decrypt, hashPassword, verifyPassword, limitLabel } from "@ll/db";
import { storeWebhook } from "@ll/db/src/ingest";
import { processEvent, nextStatus } from "@ll/db/src/process";
import { deliver, envelope, messages, reset, WABA } from "./helpers";

afterAll(() => prisma.$disconnect());

describe("X-Hub-Signature-256", () => {
  const body = '{"object":"whatsapp_business_account","entry":[{"id":"1"}]}';
  it("accepts the exact bytes signed with the app secret", () => {
    expect(verifySignature(body, sign(body, "s3cret"), "s3cret")).toBe(true);
  });
  it("rejects a tampered body, a wrong secret, a missing or malformed header", () => {
    const sig = sign(body, "s3cret");
    expect(verifySignature(body.replace("1", "2"), sig, "s3cret")).toBe(false);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(body, null, "s3cret")).toBe(false);
    expect(verifySignature(body, "sha256=abc", "s3cret")).toBe(false);
    expect(verifySignature(body, sig, "")).toBe(false);
  });
});

describe("idempotency", () => {
  beforeEach(reset);
  const inbound = messages({
    contacts: [{ wa_id: "15550201001", profile: { name: "A" } }],
    messages: [{ from: "15550201001", id: "wamid.T.1", timestamp: "1763600000", type: "text", text: { body: "hi" } }],
    statuses: [{ id: "wamid.T.out", status: "delivered", timestamp: "1763600001", recipient_id: "15550201001" }],
  });

  it("stores a byte-identical redelivery once and skips reprocessing", async () => {
    const a = await storeWebhook(prisma, JSON.stringify(inbound));
    const b = await storeWebhook(prisma, JSON.stringify(inbound));
    expect(a.id).toBe(b.id);
    expect(await processEvent(prisma, a.id)).toBe("done");
    expect(await processEvent(prisma, a.id)).toBe("skipped");
  });

  it("a different payload carrying the same message id adds nothing", async () => {
    await deliver(inbound);
    await deliver({ ...inbound, extra: "re-serialised by Meta" });
    expect(await prisma.message.count({ where: { wamid: "wamid.T.1" } })).toBe(1);
    expect(await prisma.messageStatus.count({ where: { wamid: "wamid.T.out" } })).toBe(1);
  });

  it("forced reprocessing of the same event duplicates no rows or alerts", async () => {
    const alert = envelope("account_alerts", { alert_severity: "CRITICAL", alert_type: "X", alert_description: "d" }, 1763600000);
    const ids = [await deliver(inbound), await deliver(alert)];
    await prisma.webhookEvent.updateMany({ where: { id: { in: ids } }, data: { processedAt: null } });
    for (const id of ids) await processEvent(prisma, id);
    expect(await prisma.message.count()).toBe(2);
    expect(await prisma.alert.count()).toBe(1);
  });
});

describe("24-hour customer service window", () => {
  beforeEach(reset);
  it("is open until exactly 24h after the last inbound message", () => {
    const t = new Date("2026-11-20T10:00:00Z");
    expect(isWindowOpen(t, new Date("2026-11-21T09:59:59Z"))).toBe(true);
    expect(isWindowOpen(t, new Date("2026-11-21T10:00:00Z"))).toBe(false);
    expect(isWindowOpen(null)).toBe(false);
  });

  it("marks which inbound messages opened a new window, and never moves the window backwards", async () => {
    const t0 = 1763600000;
    const msg = (id: string, t: number) => messages({ messages: [{ from: "15550201001", id, timestamp: String(t), type: "text", text: { body: id } }] });
    await deliver(msg("w.1", t0));
    await deliver(msg("w.2", t0 + 3600)); // same window
    await deliver(msg("w.3", t0 + 3600 + 86400)); // 24h after the last one: new window
    await deliver(msg("w.0", t0 - 60)); // arrives late and out of order
    const rows = await prisma.message.findMany({ orderBy: { timestamp: "asc" }, select: { wamid: true, opensWindow: true } });
    expect(rows.filter((r) => r.opensWindow).map((r) => r.wamid)).toEqual(["w.1", "w.3"]);
    const conv = await prisma.conversation.findFirstOrThrow();
    expect(conv.lastInboundAt?.getTime()).toBe((t0 + 3600 + 86400) * 1000);
  });
});

describe("message status ordering", () => {
  beforeEach(reset);
  it("moves forward only, and failed never erases a delivery", () => {
    expect(nextStatus(null, "sent")).toBe("sent");
    expect(nextStatus("read", "delivered")).toBeNull();
    expect(nextStatus("sent", "failed")).toBe("failed");
    expect(nextStatus("delivered", "failed")).toBeNull();
    expect(nextStatus("failed", "read")).toBeNull();
    expect(nextStatus("sent", "deleted")).toBeNull();
  });

  it("out-of-order receipts end on the furthest state, with pricing kept", async () => {
    const st = (status: string, t: number, extra = {}) =>
      messages({ statuses: [{ id: "wamid.O.1", status, timestamp: String(t), recipient_id: "15550201001", ...extra }] });
    await deliver(st("read", 30));
    await deliver(st("sent", 10, { pricing: { billable: true, category: "utility", pricing_model: "PMP", type: "regular" } }));
    await deliver(st("delivered", 20));
    const m = await prisma.message.findUniqueOrThrow({ where: { wamid: "wamid.O.1" } });
    expect([m.status, m.direction, m.pricingCategory, m.billable]).toEqual(["read", "OUT", "utility", true]);
    expect(m.conversationId).not.toBeNull();
  });
});

describe("template, quality and unknown-account events", () => {
  beforeEach(reset);
  it("raises one alert for a rejected template and records the reason", async () => {
    await deliver(envelope("message_template_status_update", { event: "REJECTED", message_template_id: 9, message_template_name: "promo", message_template_language: "en", reason: "INVALID_FORMAT" }, 1));
    const t = await prisma.template.findFirstOrThrow();
    expect([t.status, t.reason]).toEqual(["REJECTED", "INVALID_FORMAT"]);
    const a = await prisma.alert.findFirstOrThrow();
    expect(a.severity).toBe("critical");
    expect(a.detail).toMatch(/^Meta found a formatting problem.*\(Meta code: INVALID_FORMAT\)$/);
  });

  it("updates the messaging limit on a quality event", async () => {
    await deliver(envelope("phone_number_quality_update", { display_phone_number: "15550200100", event: "DOWNGRADE", current_limit: "TIER_250" }, 2));
    expect((await prisma.phoneNumber.findFirstOrThrow()).messagingLimit).toBe("TIER_250");
  });

  it("a FLAGGED event sets the number's quality to low, so the card and the alert agree", async () => {
    await prisma.phoneNumber.updateMany({ data: { qualityRating: "GREEN" } });
    await deliver(envelope("phone_number_quality_update", { display_phone_number: "15550200100", event: "FLAGGED", current_limit: "TIER_1K" }, 3));
    expect((await prisma.phoneNumber.findFirstOrThrow()).qualityRating).toBe("RED");
    const a = await prisma.alert.findFirstOrThrow();
    expect(a.title).toContain("quality flagged as low");
    expect(a.detail).toBe("Meta may lower the messaging limit if quality stays low. Messaging limit: 1,000 customers / 24h (Meta code: TIER_1K).");
  });

  it("labels messaging limits in plain English", () => {
    expect([limitLabel("TIER_250"), limitLabel("TIER_1K"), limitLabel("TIER_100K"), limitLabel("TIER_UNLIMITED"), limitLabel(null)])
      .toEqual(["250 customers / 24h", "1,000 customers / 24h", "1,00,000 customers / 24h", "Unlimited", "Unknown"]);
  });

  it("notes, and does not fail on, a WABA we do not manage", async () => {
    const payload = messages({ messages: [{ from: "1", id: "x", timestamp: "1", type: "text", text: { body: "x" } }] });
    payload.entry[0].id = "999";
    const id = await deliver(payload);
    const ev = await prisma.webhookEvent.findUniqueOrThrow({ where: { id } });
    expect(ev.processedAt).not.toBeNull();
    expect(ev.note).toContain("unknown WABA 999");
    expect(WABA).not.toBe("999");
  });
});

describe("secrets at rest", () => {
  it("round-trips tokens and rejects tampering", () => {
    const box = encrypt("EAAG-token");
    expect(box).not.toContain("EAAG");
    expect(decrypt(box)).toBe("EAAG-token");
    const parts = box.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("hashes passwords with scrypt and verifies them", async () => {
    const h = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong horse battery!", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@ll/db";
import { pickVariant } from "@ll/db/src/campaigns";
import { deleteContactData, importContacts, normalizePhone, parseCsv, toCsv } from "@ll/db/src/contacts";
import { fetchInboundMedia } from "@ll/db/src/media";
import { redact } from "@ll/db/src/redact";
import { purgeExpired } from "@ll/db/src/retention";
import { segmentWhere } from "@ll/db/src/segments";
import { checkUrl, isPrivateAddress } from "@ll/db/src/ssrf";
import { getObject } from "@ll/db/src/storage";
import { fromComponents, renderTemplate, slots, toComponents, validateDraft, type Draft } from "@ll/db/src/templates";
import { makeContact, makeOrg, mockGraph, reset } from "./helpers";

afterAll(() => prisma.$disconnect());

describe("phone numbers and CSV", () => {
  it("normalises to E.164 digits and rejects junk", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("919876543210");
    expect(normalizePhone("0091 98765 43210")).toBe("919876543210");
    expect(normalizePhone("98765 43210")).toBe("919876543210");
    expect(normalizePhone("(555) 010-0100", "1")).toBe("15550100100");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
  });

  it("parses quoted CSV and writes formula-safe CSV", () => {
    expect(parseCsv('phone,name\r\n"+91 98765 43210","Lathar, D ""DL"""\n\n9876500000,x')).toEqual([["phone", "name"], ["+91 98765 43210", 'Lathar, D "DL"'], ["9876500000", "x"]]);
    expect(toCsv([["=SUM(A1)", 'a"b']])).toBe(`'=SUM(A1),"a""b"\r\n`);
  });

  it("imports with dedupe and validation, and never turns an opt-out into an opt-in", async () => {
    await reset();
    const w = await makeOrg("Org", { fixture: true });
    await prisma.contact.create({ data: { orgId: w.org.id, waId: "919876500001", optInStatus: "opted_out" } });
    const rows = parseCsv("phone,name,city\n+91 98765 00001,A,Delhi\n9876500002,B,Pune\n98765 00002,B again,\nnot-a-number,C,");
    const r = await importContacts(prisma, w.org.id, rows, { phoneColumn: "phone", nameColumn: "name", attributeColumns: ["city"], tag: "import", optIn: { source: "web form", proof: "https://example.com/form" } });
    expect(r).toEqual({ created: 1, updated: 1, duplicates: 1, invalid: [{ line: 5, value: "not-a-number" }] });
    const [a, b] = await prisma.contact.findMany({ where: { orgId: w.org.id }, orderBy: { waId: "asc" }, include: { attributes: true, tags: true } });
    expect(a.optInStatus).toBe("opted_out");
    expect([b.optInStatus, b.optInSource, b.attributes[0]?.value, b.tags.length]).toEqual(["opted_in", "web form", "Pune", 1]);
  });
});

describe("segments", () => {
  it("filters by tag, opt-in and attribute, always inside the workspace", async () => {
    await reset();
    const w = await makeOrg("Org", { fixture: true });
    const other = await makeOrg("Other", { fixture: true });
    const tag = await prisma.tag.create({ data: { orgId: w.org.id, name: "vip" } });
    const c1 = await prisma.contact.create({ data: { orgId: w.org.id, waId: "15550005001", optInStatus: "opted_in", attributes: { create: { key: "city", value: "Delhi" } }, tags: { create: { tagId: tag.id } } } });
    await prisma.contact.create({ data: { orgId: w.org.id, waId: "15550005002", optInStatus: "opted_in" } });
    await prisma.contact.create({ data: { orgId: other.org.id, waId: "15550005003", optInStatus: "opted_in" } });
    const q = (rules: Parameters<typeof segmentWhere>[1]) => prisma.contact.findMany({ where: segmentWhere(w.org.id, rules), select: { id: true } });
    expect(await q({ match: "all", conditions: [{ field: "tag", op: "has", value: "vip" }, { field: "attr", op: "equals", value: "city=Delhi" }] })).toEqual([{ id: c1.id }]);
    expect(await q({ match: "all", conditions: [{ field: "optIn", op: "is", value: "opted_in" }] })).toHaveLength(2);
    expect(() => segmentWhere(w.org.id, { match: "all", conditions: [{ field: "evil", op: "is" }] })).toThrow("unknown segment field");
  });
});

describe("templates", () => {
  const draft: Draft = {
    name: "order_ready", language: "en", category: "UTILITY",
    header: { format: "TEXT", text: "Order {{1}}", example: "A-1" },
    body: "Hi {{1}}, your order {{2}} is ready.", bodyExamples: ["Asha", "A-1"], footer: "Lathar Labs",
    buttons: [{ type: "URL", text: "Track", url: "https://example.com/t/{{1}}", example: "abc" }, { type: "QUICK_REPLY", text: "Thanks" }],
  };
  it("validates against Meta's limits", () => {
    expect(validateDraft(draft)).toEqual([]);
    expect(validateDraft({ ...draft, name: "Bad Name", body: "{{2}} first", bodyExamples: [] })).toEqual(expect.arrayContaining([
      "Name: lowercase letters, numbers and underscores only.", "Body variables must be numbered {{1}}, {{2}}, ... in order, each once.", "Body cannot start or end with a variable.",
    ]));
  });
  it("round-trips through Meta's component format and renders a send", () => {
    const comps = toComponents(draft);
    expect(fromComponents("order_ready", "en", "UTILITY", comps)).toEqual(draft);
    expect(slots(comps)).toEqual(["header.1", "body.1", "body.2", "button.0.1"]);
    const r = renderTemplate({ name: "order_ready", language: "en", components: comps }, { "header.1": "A-9", "body.1": "Asha", "body.2": "A-9", "button.0.1": "xyz" });
    expect(r.preview).toBe("Hi Asha, your order A-9 is ready.");
    expect(r.payload.template.components).toEqual([
      { type: "header", parameters: [{ type: "text", text: "A-9" }] },
      { type: "body", parameters: [{ type: "text", text: "Asha" }, { type: "text", text: "A-9" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "xyz" }] },
    ]);
    expect(() => renderTemplate({ name: "x", language: "en", components: comps }, { "body.1": "only" })).toThrow("missing value for header.1, body.2, button.0.1");
  });
  it("A/B variants split deterministically by weight", () => {
    const v = [{ templateId: "a", weight: 1, variables: {} }, { templateId: "b", weight: 1, variables: {} }];
    const picks = Array.from({ length: 400 }, (_, i) => pickVariant(`c${i}`, "camp", v));
    expect(pickVariant("c1", "camp", v)).toBe(picks[1]);
    const share = picks.filter((p) => p === 0).length / 400;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });
});

describe("security helpers", () => {
  it("blocks private and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "157.240.1.1", "2a03:2880::1"]) expect(isPrivateAddress(ip), ip).toBe(false);
    expect(() => checkUrl("http://169.254.169.254/latest/meta-data")).toThrow("private or internal");
    expect(() => checkUrl("https://localhost/x")).toThrow("internal");
    expect(() => checkUrl("https://user:pw@example.com/x")).toThrow("credentials");
    expect(() => checkUrl("ftp://example.com")).toThrow("https");
    expect(checkUrl("https://hooks.example.com/x").hostname).toBe("hooks.example.com");
  });

  it("redacts tokens and keys from logs", () => {
    const s = redact("GET /v26.0/x?access_token=EAAB123abcdefghijklmnopqrstuvwxyz Authorization: Bearer sk-live-abcdefgh key ll_live_abcdefghijklmnopqrstuv");
    expect(s).not.toMatch(/EAAB123|sk-live|ll_live_abc/);
    expect(redact(new Error(`secret ${process.env.META_APP_SECRET}`))).toBe("secret [META_APP_SECRET]");
  });
});

describe("media", () => {
  it("test accounts have no file at Meta; real accounts are copied into storage", async () => {
    await reset();
    const t = await makeOrg("Test", { fixture: true });
    const fx = await prisma.message.create({ data: { orgId: t.org.id, wamid: "w.fx", phoneNumberId: t.phone.id, direction: "IN", type: "image", mediaId: "m1", mediaStatus: "pending", timestamp: new Date() } });
    expect(await fetchInboundMedia(prisma, fx.id)).toBe("unavailable");

    const r = await makeOrg("Real");
    const m = await prisma.message.create({ data: { orgId: r.org.id, wamid: "w.real", phoneNumberId: r.phone.id, direction: "IN", type: "image", mediaId: "m2", mediaStatus: "pending", timestamp: new Date() } });
    const calls = mockGraph([
      new Response(JSON.stringify({ url: "https://lookaside.test.invalid/m2", mime_type: "image/jpeg", file_size: 3 }), { status: 200 }),
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    ]);
    expect(await fetchInboundMedia(prisma, m.id)).toBe("stored");
    expect(calls[1].init.headers.Authorization).toMatch(/^Bearer /);
    const after = await prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.mediaPath).toBe(`${r.org.id}/in/${m.id}`);
    expect(Array.from(await getObject(after.mediaPath!))).toEqual([1, 2, 3]);
  });
});

describe("erasure and retention", () => {
  it("deleting a contact removes their messages, statuses and queued sends", async () => {
    await reset();
    const w = await makeOrg("Org", { fixture: true });
    const { contact, conv } = await makeContact(w.org.id, w.phone.id, "15550006001", { windowOpen: true });
    await prisma.message.create({ data: { orgId: w.org.id, wamid: "w.e1", phoneNumberId: w.phone.id, conversationId: conv.id, direction: "IN", type: "text", body: "my address is ...", timestamp: new Date() } });
    await prisma.messageStatus.create({ data: { wamid: "w.e1", status: "read", timestamp: new Date() } });
    await prisma.outboundMessage.create({ data: { orgId: w.org.id, phoneNumberId: w.phone.id, contactId: contact.id, kind: "text", category: "service", source: "inbox", payload: {}, idempotencyKey: "e1" } });
    expect(await deleteContactData(prisma, w.org.id, contact.id)).toEqual({ messages: 1, outbound: 1 });
    expect(await prisma.message.count({ where: { wamid: "w.e1" } })).toBe(0);
    expect(await prisma.messageStatus.count({ where: { wamid: "w.e1" } })).toBe(0);
    expect(await prisma.contact.count({ where: { id: contact.id } })).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "contact.erase" } });
    expect(JSON.stringify(log)).not.toContain("15550006001");
  });

  it("purges old messages and processed events per workspace settings", async () => {
    await reset();
    const w = await makeOrg("Org", { fixture: true });
    await prisma.organization.update({ where: { id: w.org.id }, data: { messageRetentionDays: 30, eventRetentionDays: 7 } });
    const old = new Date(Date.now() - 40 * 86_400_000);
    await prisma.message.create({ data: { orgId: w.org.id, wamid: "w.old", phoneNumberId: w.phone.id, direction: "IN", type: "text", timestamp: old } });
    await prisma.message.create({ data: { orgId: w.org.id, wamid: "w.new", phoneNumberId: w.phone.id, direction: "IN", type: "text", timestamp: new Date() } });
    await prisma.webhookEvent.create({ data: { orgId: w.org.id, dedupeKey: "old", rawBody: "{}", receivedAt: old, processedAt: old } });
    await prisma.webhookEvent.create({ data: { orgId: w.org.id, dedupeKey: "stuck", rawBody: "{}", receivedAt: old } });
    expect(await purgeExpired(prisma)).toEqual({ messages: 1, events: 1, deliveries: 0 });
    expect(await prisma.webhookEvent.count({ where: { dedupeKey: "stuck" } })).toBe(1); // unprocessed events are kept
  });
});

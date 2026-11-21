/** Two workspaces side by side: nothing in one can read or change the other. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@ll/db";
import { authenticateApiKey, createApiKey } from "@ll/db/src/apikeys";
import { startFlow, handleApiEvent } from "@ll/db/src/automation";
import { audienceWhere, launchCampaign, setCampaignState } from "@ll/db/src/campaigns";
import { deleteContactData } from "@ll/db/src/contacts";
import { storeWebhook } from "@ll/db/src/ingest";
import { noJobs } from "@ll/db/src/jobs";
import { applyOptOut } from "@ll/db/src/optout";
import { processEvent } from "@ll/db/src/process";
import { checkSend, enqueueSend, SendRefused } from "@ll/db/src/send";
import { putObject } from "@ll/db/src/storage";
import { makeContact, makeOrg, reset } from "./helpers";

afterAll(() => prisma.$disconnect());

async function two() {
  await reset();
  const a = await makeOrg("Workspace A", { fixture: true });
  const b = await makeOrg("Workspace B", { fixture: true });
  const ca = await makeContact(a.org.id, a.phone.id, "15550001001", { optIn: true, windowOpen: true });
  const cb = await makeContact(b.org.id, b.phone.id, "15550001001", { optIn: true, windowOpen: true }); // same phone, other workspace
  return { a, b, ca, cb };
}

const envelopeFor = (wabaId: string, phoneId: string, value: object) => ({
  object: "whatsapp_business_account",
  entry: [{ id: wabaId, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneId }, ...value } }] }],
});

describe("workspace isolation", () => {
  let w: Awaited<ReturnType<typeof two>>;
  beforeEach(async () => { w = await two(); });

  it("a webhook is stored under the workspace that owns the WABA; unknown accounts belong to nobody", async () => {
    const evB = await storeWebhook(prisma, JSON.stringify(envelopeFor(w.b.waba.metaWabaId, w.b.phone.metaPhoneNumberId, {})));
    const evX = await storeWebhook(prisma, JSON.stringify(envelopeFor("999999", "1", {})));
    const rows = await prisma.webhookEvent.findMany({ where: { id: { in: [evB.id, evX.id] } } });
    expect(rows.find((r) => r.id === evB.id)?.orgId).toBe(w.b.org.id);
    expect(rows.find((r) => r.id === evX.id)?.orgId).toBeNull();
  });

  it("an inbound message for B never creates or touches A's contact or conversation", async () => {
    const ev = await storeWebhook(prisma, JSON.stringify(envelopeFor(w.b.waba.metaWabaId, w.b.phone.metaPhoneNumberId, {
      messages: [{ from: "15550001001", id: "wamid.B1", timestamp: "1800000000", type: "text", text: { body: "hi B" } }],
    })));
    await processEvent(prisma, ev.id);
    expect(await prisma.message.count({ where: { orgId: w.a.org.id } })).toBe(0);
    const m = await prisma.message.findUniqueOrThrow({ where: { wamid: "wamid.B1" } });
    expect([m.orgId, m.conversationId]).toEqual([w.b.org.id, w.cb.conv.id]);
  });

  it("a status update that names A's message but arrives on B's number is ignored", async () => {
    await prisma.message.create({ data: { orgId: w.a.org.id, wamid: "wamid.A-out", phoneNumberId: w.a.phone.id, direction: "OUT", type: "text", status: "sent", timestamp: new Date() } });
    const ev = await storeWebhook(prisma, JSON.stringify(envelopeFor(w.b.waba.metaWabaId, w.b.phone.metaPhoneNumberId, {
      statuses: [{ id: "wamid.A-out", status: "read", timestamp: "1800000000", recipient_id: "15550001001" }],
    })));
    await processEvent(prisma, ev.id);
    expect((await prisma.message.findUniqueOrThrow({ where: { wamid: "wamid.A-out" } })).status).toBe("sent");
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).note).toContain("belongs to another number");
  });

  it("a send cannot mix A's number with B's contact", async () => {
    expect(await checkSend(prisma, { orgId: w.a.org.id, phoneNumberId: w.a.phone.id, contactId: w.cb.contact.id, kind: "text", category: "service", source: "inbox" }))
      .toEqual({ block: "That contact is not in this workspace." });
    expect(await checkSend(prisma, { orgId: w.a.org.id, phoneNumberId: w.b.phone.id, contactId: w.ca.contact.id, kind: "text", category: "service", source: "inbox" }))
      .toEqual({ block: "That number is not in this workspace." });
    await expect(enqueueSend(prisma, noJobs, {
      orgId: w.a.org.id, phoneNumberId: w.a.phone.id, contactId: w.cb.contact.id, kind: "text", category: "service", source: "inbox",
      payload: { type: "text", text: { body: "x" } }, idempotencyKey: "x1",
    })).rejects.toBeInstanceOf(SendRefused);
  });

  it("campaigns, segments and flows from B are not found from A", async () => {
    const seg = await prisma.segment.create({ data: { orgId: w.b.org.id, name: "B only", rules: { match: "all", conditions: [] } } });
    await expect(audienceWhere(prisma, w.a.org.id, seg.id)).rejects.toThrow("not found");
    const camp = await prisma.campaign.create({ data: { orgId: w.b.org.id, phoneNumberId: w.b.phone.id, name: "B", variants: [] } });
    await expect(launchCampaign(prisma, w.a.org.id, camp.id)).rejects.toThrow("not found");
    await expect(setCampaignState(prisma, noJobs, w.a.org.id, camp.id, "cancel")).rejects.toThrow("not found");
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: camp.id } })).status).toBe("draft");
    const flow = await prisma.flow.create({ data: { orgId: w.b.org.id, name: "B flow", graph: { start: "a", nodes: { a: { type: "end" } } } } });
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: w.ca.conv.id }, include: { contact: { include: { attributes: true } } } });
    expect(await startFlow({ db: prisma, jobs: noJobs }, flow.id, conv, null)).toBe("missing");
  });

  it("erasure and opt-out from A cannot affect B's contact", async () => {
    expect(await deleteContactData(prisma, w.a.org.id, w.cb.contact.id)).toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: w.cb.contact.id } })).not.toBeNull();
    await applyOptOut(prisma, { orgId: w.a.org.id, contactId: w.cb.contact.id, source: "test" });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: w.cb.contact.id } })).optInStatus).toBe("opted_in");
  });

  it("an API key acts only in its own workspace, and a revoked key does nothing", async () => {
    const { key, row } = await createApiKey(prisma, w.a.org.id, "test", ["events:write"]);
    const auth = await authenticateApiKey(prisma, `Bearer ${key}`);
    expect(auth?.orgId).toBe(w.a.org.id);
    await handleApiEvent({ db: prisma, jobs: noJobs }, auth!.orgId, { name: "signup", phone: "+15550009999", data: {} });
    expect(await prisma.contact.count({ where: { waId: "15550009999", orgId: w.b.org.id } })).toBe(0);
    expect(await prisma.contact.count({ where: { waId: "15550009999", orgId: w.a.org.id } })).toBe(1);
    await prisma.apiKey.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    expect(await authenticateApiKey(prisma, `Bearer ${key}`)).toBeNull();
    expect(await authenticateApiKey(prisma, "Bearer ll_live_not-a-real-key-at-all-123")).toBeNull();
  });

  it("storage keys cannot escape the media directory", async () => {
    await expect(putObject("../../etc/passwd", new Uint8Array([1]), "text/plain")).rejects.toThrow("bad storage key");
    await expect(putObject(`${w.a.org.id}/../${w.b.org.id}/x`, new Uint8Array([1]), "text/plain")).rejects.toThrow("bad storage key");
  });
});

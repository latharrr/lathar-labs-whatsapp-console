"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { encrypt, prisma } from "@ll/db";
import { createApiKey } from "@ll/db/src/apikeys";
import { OUT_EVENTS } from "@ll/db/src/outhooks";
import { API_SCOPES } from "@ll/db/src/permissions";
import { enqueueWebhookEvent } from "@ll/db/src/queue";
import { checkUrl } from "@ll/db/src/ssrf";
import { audit } from "@/lib/audit";
import { requireCan } from "@/lib/session";
import { act, str, webJobs, type ActionState } from "@/lib/server";

export async function createKey(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("developer.manage");
    const scopes = f.getAll("scope").map(String).filter((s) => (API_SCOPES as readonly string[]).includes(s));
    if (!str(f, "name") || !scopes.length) throw new Error("Name the key and pick at least one scope.");
    const { key, row } = await createApiKey(prisma, m.orgId, str(f, "name").slice(0, 60), scopes, m.userId);
    await audit(m, "apikey.create", row.id, { scopes });
    revalidatePath("/developer");
    return { ok: "Key created. Copy it now: it is not shown again.", data: { key } };
  });
}

export async function revokeKey(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("developer.manage");
    const r = await prisma.apiKey.updateMany({ where: { id: str(f, "id"), orgId: m.orgId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new Error("Key not found.");
    await audit(m, "apikey.revoke", str(f, "id"));
    revalidatePath("/developer");
    return "Revoked. Requests with it now get 401.";
  });
}

export async function createHook(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("developer.manage");
    const url = checkUrl(str(f, "url")).toString();
    const events = f.getAll("event").map(String).filter((e) => e === "*" || (OUT_EVENTS as readonly string[]).includes(e));
    if (!events.length) throw new Error("Pick at least one event.");
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const h = await prisma.outboundWebhook.create({ data: { orgId: m.orgId, name: str(f, "name").slice(0, 60) || new URL(url).hostname, url, events, secretEnc: encrypt(secret) } });
    await audit(m, "webhook_out.create", h.id, { host: new URL(url).hostname, events });
    revalidatePath("/developer/webhooks");
    return { ok: "Webhook added. Copy the signing secret now: it is not shown again.", data: { key: secret } };
  });
}

export async function toggleHook(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("developer.manage");
    const h = await prisma.outboundWebhook.findFirst({ where: { id: str(f, "id"), orgId: m.orgId } });
    if (!h) throw new Error("Webhook not found.");
    await prisma.outboundWebhook.update({ where: { id: h.id }, data: { enabled: !h.enabled } });
    await audit(m, h.enabled ? "webhook_out.disable" : "webhook_out.enable", h.id);
    revalidatePath("/developer/webhooks");
    return h.enabled ? "Paused." : "Resumed.";
  });
}

export async function deleteHook(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("developer.manage");
    const r = await prisma.outboundWebhook.deleteMany({ where: { id: str(f, "id"), orgId: m.orgId } });
    if (!r.count) throw new Error("Webhook not found.");
    await audit(m, "webhook_out.delete", str(f, "id"));
    revalidatePath("/developer/webhooks");
    return "Deleted.";
  });
}

export async function testHook(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("developer.manage");
    const h = await prisma.outboundWebhook.findFirst({ where: { id: str(f, "id"), orgId: m.orgId } });
    if (!h) throw new Error("Webhook not found.");
    const d = await prisma.webhookDelivery.create({ data: { webhookId: h.id, event: "test", payload: { event: "test", data: { message: "Test delivery from the Lathar Labs dashboard" }, sentAt: new Date().toISOString() } } });
    await webJobs.deliver(d.id);
    await audit(m, "webhook_out.test", h.id);
    revalidatePath("/developer/webhooks");
    return "Test delivery queued. The result shows below in a few seconds.";
  });
}

/** Replays a stored Meta event through the same processor. Idempotent: already-stored messages are skipped. */
export async function replayEvent(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("developer.manage");
    const ev = await prisma.webhookEvent.findFirst({ where: { id: str(f, "id"), orgId: m.orgId } });
    if (!ev) throw new Error("Event not found.");
    await prisma.webhookEvent.update({ where: { id: ev.id }, data: { processedAt: null, attempts: 0, lastError: null } });
    await enqueueWebhookEvent(ev.id).catch(() => {}); // the sweeper picks it up if Redis is down
    await audit(m, "webhook.replay", ev.id);
    revalidatePath(`/developer/events/${ev.id}`);
    return "Replayed. Anything already stored is skipped, so this cannot duplicate messages.";
  });
}

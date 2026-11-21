/** Outbound webhooks: forward events to the customer's own systems (their app, n8n). Signed and SSRF-guarded. */
import { createHmac } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { decrypt } from "./crypto";
import type { Jobs } from "./jobs";
import { redact } from "./redact";
import { safeRequest } from "./ssrf";

export const OUT_EVENTS = ["message.received", "message.status", "contact.opted_out", "contact.opted_in", "template.status", "campaign.completed", "api.event"] as const;
export const MAX_DELIVERY_ATTEMPTS = 6;

export async function emit(db: PrismaClient, jobs: Jobs, orgId: string, event: (typeof OUT_EVENTS)[number], data: Record<string, unknown>) {
  const hooks = await db.outboundWebhook.findMany({ where: { orgId, enabled: true, OR: [{ events: { has: event } }, { events: { has: "*" } }] } });
  for (const h of hooks) {
    const d = await db.webhookDelivery.create({ data: { webhookId: h.id, event, payload: { event, data, sentAt: new Date().toISOString() } as Prisma.InputJsonObject } });
    await jobs.deliver(d.id);
  }
  return hooks.length;
}

export const signBody = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

/** One attempt. Returns the delay before the next attempt, or null when finished (ok or out of attempts). */
export async function deliver(db: PrismaClient, deliveryId: string): Promise<number | null> {
  const d = await db.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: true } });
  if (!d || d.status === "ok" || !d.webhook.enabled) return null;
  const body = JSON.stringify(d.payload);
  let code: number | null = null;
  let error: string | null = null;
  try {
    const res = await safeRequest(d.webhook.url, {
      body, headers: { "Content-Type": "application/json", "X-LL-Event": d.event, "X-LL-Delivery": d.id, "X-LL-Signature-256": signBody(decrypt(d.webhook.secretEnc), body) },
    });
    code = res.status;
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (e) {
    error = redact(e).slice(0, 300);
  }
  const attempts = d.attempts + 1;
  const done = !error || attempts >= MAX_DELIVERY_ATTEMPTS;
  await db.webhookDelivery.update({
    where: { id: d.id },
    data: { attempts, responseCode: code, error, status: !error ? "ok" : done ? "failed" : "pending", deliveredAt: !error ? new Date() : null },
  });
  return done ? null : Math.min(3_600_000, 10_000 * 3 ** (attempts - 1));
}

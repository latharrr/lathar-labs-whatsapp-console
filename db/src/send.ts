/**
 * The outbox. Every send (inbox, campaign, automation, API, opt-out reply) goes through enqueueSend and
 * performSend, so the rules live in one place and run twice: when the send is queued and again right before
 * it goes to Meta (a contact can opt out, a window can close or a campaign can be cancelled in between).
 *
 * Duplicates: idempotencyKey is unique, and performSend claims a row with an atomic queued -> sending update,
 * so two jobs for the same row cannot both send. A send whose outcome is unknown (timeout after the request
 * left) is marked "unknown" and never retried automatically.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { decrypt } from "./crypto";
import { GraphError, graphPost, isRetryable, uploadMedia } from "./graph";
import type { Jobs } from "./jobs";
import { applyOptOut } from "./optout";
import { redact } from "./redact";
import { getObject } from "./storage";
import { isWindowOpen } from "./window";

export type Kind = "text" | "template" | "media" | "interactive" | "read";
export type Category = "marketing" | "utility" | "authentication" | "service";

export type SendInput = {
  orgId: string;
  phoneNumberId: string;
  contactId: string;
  kind: Kind;
  /** Graph message object without to/messaging_product. Keys starting with "_" are ours and are not sent. */
  payload: Record<string, unknown>;
  category: Category;
  source: "inbox" | "campaign" | "automation" | "api" | "optout";
  idempotencyKey: string;
  campaignId?: string;
  createdById?: string;
  delayMs?: number;
};

export class SendRefused extends Error {}

export const MAX_ATTEMPTS = 5;
export type Verdict = { block: string } | { hold: string } | null;

/** null = allowed. block = never send. hold = not now (campaign paused). */
export async function checkSend(
  db: PrismaClient,
  o: { orgId: string; phoneNumberId: string; contactId: string; kind: string; category: string; source: string; campaignId?: string | null },
  now = new Date(),
): Promise<Verdict> {
  const phone = await db.phoneNumber.findFirst({ where: { id: o.phoneNumberId, waba: { orgId: o.orgId } }, select: { id: true } });
  if (!phone) return { block: "That number is not in this workspace." };
  const contact = await db.contact.findFirst({ where: { id: o.contactId, orgId: o.orgId } });
  if (!contact) return { block: "That contact is not in this workspace." };
  if (o.kind === "read") return null;
  if (contact.blocked) return { block: "This contact is blocked." };
  if (o.category === "marketing") {
    if (contact.optInStatus === "opted_out") return { block: "This contact opted out of marketing messages." };
    if (contact.optInStatus !== "opted_in") return { block: "This contact has no recorded marketing opt-in." };
  }
  if ((o.source === "automation" || o.source === "campaign") && contact.optInStatus === "opted_out")
    return { block: "This contact opted out, so automated messages are off." };
  if (o.kind !== "template") {
    const conv = await db.conversation.findUnique({ where: { phoneNumberId_contactId: { phoneNumberId: o.phoneNumberId, contactId: o.contactId } } });
    if (!isWindowOpen(conv?.lastInboundAt, now)) return { block: "The 24-hour customer service window is closed. Only templates can be sent." };
  }
  if (o.campaignId) {
    const c = await db.campaign.findFirst({ where: { id: o.campaignId, orgId: o.orgId }, select: { status: true } });
    if (!c) return { block: "Campaign not found." };
    if (c.status === "cancelled") return { block: "The campaign was cancelled." };
    if (c.status !== "running") return { hold: "The campaign is paused." };
  }
  return null;
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Queue a send. Throws SendRefused with a plain reason if the rules forbid it. Same key twice = same row. */
export async function enqueueSend(db: PrismaClient, jobs: Jobs, input: SendInput) {
  const verdict = await checkSend(db, input);
  if (verdict && "block" in verdict) throw new SendRefused(verdict.block);
  const conv = await db.conversation.findUnique({ where: { phoneNumberId_contactId: { phoneNumberId: input.phoneNumberId, contactId: input.contactId } }, select: { id: true } });
  let row;
  try {
    row = await db.outboundMessage.create({
      data: {
        orgId: input.orgId, phoneNumberId: input.phoneNumberId, contactId: input.contactId, conversationId: conv?.id,
        kind: input.kind, payload: input.payload as Prisma.InputJsonObject, category: input.category, source: input.source,
        idempotencyKey: input.idempotencyKey, campaignId: input.campaignId, createdById: input.createdById,
        notBefore: input.delayMs ? new Date(Date.now() + input.delayMs) : null,
      },
    });
  } catch (e) {
    if (!isUnique(e)) throw e;
    return db.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
  }
  await jobs.send(row.id, input.delayMs ?? 0);
  return row;
}

/** "TIER_1K" -> 1000; unlimited or unknown -> null (no local cap). */
export function tierLimit(tier?: string | null): number | null {
  const m = /^TIER_(\d+)(K?)$/.exec(tier ?? "");
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : null;
}

const backoff = (attempt: number) => Math.min(10 * 60_000, 5000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 1000);

function graphBody(payload: Record<string, unknown>, to: string, mediaId?: string) {
  const out: Record<string, unknown> = { messaging_product: "whatsapp" };
  for (const [k, v] of Object.entries(payload)) if (!k.startsWith("_")) out[k] = v;
  if (payload.status === "read") return out;
  out.recipient_type = "individual";
  out.to = to;
  if (mediaId) {
    const t = String(payload.type);
    out[t] = { ...(out[t] as object), id: mediaId };
  }
  return out;
}

export type SendDeps = {
  now?: Date;
  /** ms to wait before this number may send again; the worker passes a Redis token bucket */
  rateLimit?: (phoneNumberId: string, perSecond: number) => Promise<number>;
};

export type SendResult = "sent" | "skipped" | "held" | "blocked" | "throttled" | "retry" | "failed" | "unknown";

export async function performSend(db: PrismaClient, jobs: Jobs, id: string, deps: SendDeps = {}): Promise<SendResult> {
  const now = deps.now ?? new Date();
  const claimed = await db.outboundMessage.updateMany({
    where: { id, status: "queued", OR: [{ notBefore: null }, { notBefore: { lte: now } }] },
    data: { status: "sending", attempts: { increment: 1 } },
  });
  if (!claimed.count) {
    const o = await db.outboundMessage.findUnique({ where: { id }, select: { status: true, notBefore: true } });
    if (o?.status === "queued" && o.notBefore && o.notBefore > now) await jobs.send(id, o.notBefore.getTime() - now.getTime());
    return "skipped"; // already sent, cancelled, or another job holds it
  }
  const o = await db.outboundMessage.findUniqueOrThrow({ where: { id }, include: { contact: true, phoneNumber: { include: { waba: true } } } });
  const requeue = async (ms: number, note: string) => {
    await db.outboundMessage.update({ where: { id }, data: { status: "queued", notBefore: new Date(now.getTime() + ms), errorMessage: note, attempts: { decrement: 1 } } });
    await jobs.send(id, ms);
  };

  const verdict = await checkSend(db, o, now);
  if (verdict && "hold" in verdict) {
    // paused campaign: back to queued with no job; resume re-queues it
    await db.outboundMessage.update({ where: { id }, data: { status: "queued", errorMessage: verdict.hold, attempts: { decrement: 1 } } });
    return "held";
  }
  if (verdict) {
    await db.outboundMessage.update({ where: { id }, data: { status: "blocked", errorMessage: verdict.block } });
    await db.campaignRecipient.updateMany({ where: { outboundId: id }, data: { status: "skipped", skipReason: verdict.block } });
    return "blocked";
  }

  // Portfolio messaging limit: unique customers reached by business-initiated templates in 24h.
  // shortcut: counts every non-service template as business-initiated (over-counts), until Meta exposes usage per portfolio
  const cap = tierLimit(o.phoneNumber.messagingLimit);
  if (cap && o.kind === "template" && o.category !== "service") {
    const since = new Date(now.getTime() - 86_400_000);
    const used = await db.outboundMessage.findMany({
      where: { orgId: o.orgId, kind: "template", category: { not: "service" }, status: "sent", sentAt: { gte: since }, phoneNumber: { wabaId: o.phoneNumber.wabaId } },
      distinct: ["contactId"], select: { contactId: true },
    });
    if (used.length >= cap && !used.some((u) => u.contactId === o.contactId)) {
      await requeue(30 * 60_000, `Waiting: messaging limit of ${cap} customers per 24 hours reached.`);
      return "held";
    }
  }

  const wait = deps.rateLimit ? await deps.rateLimit(o.phoneNumberId, o.phoneNumber.sendsPerSecond) : 0;
  if (wait > 0) {
    await requeue(wait, "Waiting for the number's send rate.");
    return "throttled";
  }

  const payload = o.payload as Record<string, unknown>;
  const isTest = o.phoneNumber.isFixture || o.phoneNumber.waba.isFixture;
  let wamid: string | undefined;
  try {
    if (isTest) {
      wamid = o.kind === "read" ? undefined : `wamid.TEST.${o.id}`; // test account: nothing leaves this machine
    } else {
      const token = decrypt(o.phoneNumber.waba.accessTokenEnc);
      let mediaId: string | undefined;
      const media = payload._media as { key: string; mime: string; name: string } | undefined;
      if (media) mediaId = await uploadMedia(o.phoneNumber.metaPhoneNumberId, token, await getObject(media.key), media.mime, media.name);
      const r = await graphPost<{ messages?: { id: string }[]; success?: boolean }>(
        `${o.phoneNumber.metaPhoneNumberId}/messages`, token, graphBody(payload, o.contact.waId, mediaId));
      wamid = r.messages?.[0]?.id;
      if (o.kind !== "read" && !wamid) throw new GraphError(200, 0, "Meta accepted the request but returned no message id", true);
    }
  } catch (e) {
    const g = e instanceof GraphError ? e : null;
    const message = redact(e).slice(0, 500);
    if (g?.ambiguous) {
      await db.outboundMessage.update({ where: { id }, data: { status: "unknown", errorMessage: `${message}. Not retried, to avoid a duplicate.` } });
      await db.campaignRecipient.updateMany({ where: { outboundId: id }, data: { status: "failed", skipReason: "outcome unknown" } });
      return "unknown";
    }
    if (g && isRetryable(g) && o.attempts < MAX_ATTEMPTS) {
      await db.outboundMessage.update({ where: { id }, data: { errorCode: g.code || g.status, errorMessage: message, attempts: { increment: 1 } } }); // requeue gives one back
      await requeue(backoff(o.attempts), message);
      return "retry";
    }
    await db.outboundMessage.update({ where: { id }, data: { status: "failed", errorCode: g ? g.code || g.status : null, errorMessage: message } });
    await db.campaignRecipient.updateMany({ where: { outboundId: id }, data: { status: "failed", errorCode: g?.code ?? null } });
    if (g?.code === 131050) await applyOptOut(db, { orgId: o.orgId, contactId: o.contactId, source: "meta: user stopped marketing messages (131050)" });
    await jobs.publish(o.orgId, { type: "outbound", id });
    return "failed";
  }

  await db.$transaction(async (tx) => {
    await tx.outboundMessage.update({ where: { id }, data: { status: "sent", wamid: wamid ?? null, sentAt: now, errorMessage: null } });
    if (o.kind === "read" || !wamid) return;
    const media = payload._media as { key: string; mime: string; name: string } | undefined;
    await tx.message.create({
      data: {
        orgId: o.orgId, wamid, outboundId: id, phoneNumberId: o.phoneNumberId, conversationId: o.conversationId, direction: "OUT",
        type: String(payload.type ?? o.kind), body: String(payload._preview ?? ""), payload: payload as Prisma.InputJsonObject,
        sentById: o.createdById, isTest, status: isTest ? "sent" : null, timestamp: now,
        ...(media ? { mediaPath: media.key, mediaMime: media.mime, mediaName: media.name, mediaStatus: "stored" } : {}),
      },
    });
    if (o.conversationId)
      await tx.conversation.update({
        where: { id: o.conversationId },
        data: { lastMessageAt: now, lastMessagePreview: String(payload._preview ?? "").slice(0, 140), unread: 0 },
      });
    if (o.source === "inbox" && o.conversationId)
      await tx.conversation.updateMany({ where: { id: o.conversationId, firstResponseAt: null }, data: { firstResponseAt: now } });
    await tx.campaignRecipient.updateMany({ where: { outboundId: id }, data: { status: "sent", wamid } });
  });
  await jobs.publish(o.orgId, { type: "outbound", id, conversationId: o.conversationId });
  return "sent";
}

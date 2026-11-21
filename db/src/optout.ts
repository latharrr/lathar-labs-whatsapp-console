import type { PrismaClient } from "@prisma/client";

/** "Stop!", " stop ", "STOP." all match STOP. Whole-message match only, so "don't stop" is not an opt-out. */
export const normalizeKeyword = (s: string) =>
  s.normalize("NFKC").trim().toUpperCase().replace(/[^\p{L}\p{N} ]+/gu, "").replace(/\s+/g, " ").trim();

export const matchesKeyword = (text: string | null | undefined, keywords: string[]) =>
  !!text && keywords.map(normalizeKeyword).filter(Boolean).includes(normalizeKeyword(text));

/**
 * Marketing opt-out, effective immediately: the contact is marked, and every queued campaign, marketing or
 * automated send to them is cancelled. The send worker re-checks before each send, so a job already in Redis
 * cannot slip through either.
 */
export async function applyOptOut(db: PrismaClient, p: { orgId: string; contactId: string; source: string; at?: Date }) {
  const at = p.at ?? new Date();
  const updated = await db.contact.updateMany({
    where: { id: p.contactId, orgId: p.orgId },
    data: { optInStatus: "opted_out", optOutAt: at, optOutSource: p.source },
  });
  if (!updated.count) return { cancelled: 0 };
  const cancelled = await db.outboundMessage.updateMany({
    where: { orgId: p.orgId, contactId: p.contactId, status: "queued", OR: [{ category: "marketing" }, { source: { in: ["campaign", "automation"] } }] },
    data: { status: "cancelled", errorMessage: "Contact opted out" },
  });
  await db.campaignRecipient.updateMany({
    where: { contactId: p.contactId, campaign: { orgId: p.orgId }, status: { in: ["pending", "queued"] } },
    data: { status: "cancelled", skipReason: "opted_out" },
  });
  await db.auditLog.create({ data: { orgId: p.orgId, action: "contact.opt_out", target: p.contactId, meta: { source: p.source, cancelledSends: cancelled.count } } });
  return { cancelled: cancelled.count };
}

/** Opt-in needs a source; proof is whatever shows consent (form URL, message id, signed paper). */
export async function applyOptIn(db: PrismaClient, p: { orgId: string; contactId: string; source: string; proof?: string | null; at?: Date; userId?: string }) {
  const updated = await db.contact.updateMany({
    where: { id: p.contactId, orgId: p.orgId },
    data: { optInStatus: "opted_in", optInAt: p.at ?? new Date(), optInSource: p.source, optInProof: p.proof ?? null, optOutAt: null, optOutSource: null },
  });
  if (updated.count)
    await db.auditLog.create({ data: { orgId: p.orgId, userId: p.userId, action: "contact.opt_in", target: p.contactId, meta: { source: p.source, proof: p.proof ?? null } } });
  return updated.count > 0;
}

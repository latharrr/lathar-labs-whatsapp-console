/**
 * Campaigns. Launch snapshots the audience into recipients (eligible ones pending, the rest skipped with a
 * reason). A dispatcher tick, every DISPATCH_MS, queues at most throttlePerMinute per minute per campaign,
 * counting sends still in flight. Every send then passes the outbox checks again right before it goes out.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { RETRYABLE_CODES } from "./graph";
import type { Jobs } from "./jobs";
import { segmentWhere, type Rules } from "./segments";
import { enqueueSend, SendRefused, tierLimit } from "./send";
import { renderTemplate, resolveValue } from "./templates";

export const DISPATCH_MS = 5000;

export type Variant = { templateId: string; weight: number; variables: Record<string, string> };

export function pickVariant(contactId: string, campaignId: string, variants: Variant[]): number {
  const total = variants.reduce((a, v) => a + Math.max(0, v.weight), 0) || 1;
  const h = createHash("sha256").update(`${campaignId}:${contactId}`).digest().readUInt32BE(0) / 2 ** 32;
  let acc = 0;
  for (const [i, v] of variants.entries()) {
    acc += Math.max(0, v.weight) / total;
    if (h < acc) return i;
  }
  return variants.length - 1;
}

export async function audienceWhere(db: PrismaClient, orgId: string, segmentId?: string | null): Promise<Prisma.ContactWhereInput> {
  if (!segmentId) return { orgId };
  const seg = await db.segment.findFirst({ where: { id: segmentId, orgId } });
  if (!seg) throw new Error("Segment not found in this workspace.");
  return segmentWhere(orgId, seg.rules as Rules);
}

const reasonFor = (c: { blocked: boolean; optInStatus: string }) =>
  c.blocked ? "blocked" : c.optInStatus === "opted_out" ? "opted_out" : c.optInStatus !== "opted_in" ? "no_opt_in" : null;

/** Everything the review step shows before a send. Cost stays null while rates are unset. */
export async function precheck(db: PrismaClient, orgId: string, c: { phoneNumberId: string; segmentId?: string | null; variants: Variant[] }) {
  const phone = await db.phoneNumber.findFirst({ where: { id: c.phoneNumberId, waba: { orgId } }, include: { waba: true } });
  if (!phone) throw new Error("Number not found in this workspace.");
  const contacts = await db.contact.findMany({ where: await audienceWhere(db, orgId, c.segmentId), select: { blocked: true, optInStatus: true } });
  const skipped: Record<string, number> = {};
  let eligible = 0;
  for (const x of contacts) {
    const r = reasonFor(x);
    if (r) skipped[r] = (skipped[r] ?? 0) + 1; else eligible++;
  }
  const templates = await db.template.findMany({ where: { id: { in: c.variants.map((v) => v.templateId) }, waba: { orgId } } });
  const categories = [...new Set(templates.map((t) => (t.category ?? "MARKETING").toLowerCase()))];
  const limit = tierLimit(phone.messagingLimit);
  let rates: Record<string, number> = {};
  try { rates = JSON.parse(process.env.PRICING_RATES || "{}"); } catch {}
  const rate = categories.length === 1 && typeof rates[categories[0]] === "number" && rates[categories[0]] > 0 ? rates[categories[0]] : null;
  return {
    audience: contacts.length, eligible, skipped,
    limit, overLimit: limit !== null && eligible > limit,
    quality: phone.qualityRating ?? "UNKNOWN",
    templatesApproved: templates.length === c.variants.length && templates.every((t) => t.status === "APPROVED"),
    categories, isTest: phone.isFixture || phone.waba.isFixture,
    cost: rate === null ? null : { amount: eligible * rate, currency: process.env.PRICING_CURRENCY || "INR" },
  };
}

export async function launchCampaign(db: PrismaClient, orgId: string, campaignId: string, userId?: string) {
  const c = await db.campaign.findFirst({ where: { id: campaignId, orgId } });
  if (!c) throw new Error("Campaign not found.");
  if (c.status !== "draft") throw new Error(`This campaign is already ${c.status}.`);
  const variants = c.variants as Variant[];
  const pre = await precheck(db, orgId, { phoneNumberId: c.phoneNumberId, segmentId: c.segmentId, variants });
  if (!pre.templatesApproved) throw new Error("Every template in the campaign must be approved by Meta.");
  if (pre.quality === "RED") throw new Error("The number's quality is low. Sending more now risks a lower limit or a block.");
  if (!pre.eligible) throw new Error("No one in this audience has a recorded marketing opt-in.");
  const contacts = await db.contact.findMany({ where: await audienceWhere(db, orgId, c.segmentId), select: { id: true, blocked: true, optInStatus: true } });
  await db.campaignRecipient.createMany({
    data: contacts.map((x) => {
      const r = reasonFor(x);
      return { campaignId, contactId: x.id, variant: pickVariant(x.id, campaignId, variants), status: r ? "skipped" : "pending", skipReason: r };
    }),
    skipDuplicates: true,
  });
  const future = c.scheduledAt && c.scheduledAt > new Date();
  await db.campaign.update({ where: { id: campaignId }, data: { status: future ? "scheduled" : "running", startedAt: future ? null : new Date() } });
  await db.auditLog.create({ data: { orgId, userId, action: future ? "campaign.schedule" : "campaign.launch", target: campaignId, meta: { eligible: pre.eligible, skipped: pre.skipped } } });
  return pre;
}

export async function setCampaignState(db: PrismaClient, jobs: Jobs, orgId: string, campaignId: string, action: "pause" | "resume" | "cancel", userId?: string) {
  const c = await db.campaign.findFirst({ where: { id: campaignId, orgId } });
  if (!c) throw new Error("Campaign not found.");
  const allowed: Record<string, string[]> = { pause: ["running", "scheduled"], resume: ["paused"], cancel: ["running", "scheduled", "paused", "draft"] };
  if (!allowed[action].includes(c.status)) throw new Error(`Cannot ${action} a ${c.status} campaign.`);
  if (action === "cancel") {
    await db.$transaction([
      db.campaign.update({ where: { id: c.id }, data: { status: "cancelled", completedAt: new Date() } }),
      db.outboundMessage.updateMany({ where: { campaignId: c.id, status: "queued" }, data: { status: "cancelled", errorMessage: "Campaign cancelled" } }),
      db.campaignRecipient.updateMany({ where: { campaignId: c.id, status: { in: ["pending", "queued"] } }, data: { status: "cancelled" } }),
    ]);
  } else if (action === "pause") {
    await db.campaign.update({ where: { id: c.id }, data: { status: "paused" } });
  } else {
    await db.campaign.update({ where: { id: c.id }, data: { status: "running", startedAt: c.startedAt ?? new Date() } });
    // sends that were held while paused go back on the queue; the claim stops any double send
    const held = await db.outboundMessage.findMany({ where: { campaignId: c.id, status: "queued" }, select: { id: true } });
    for (const h of held) await jobs.send(h.id);
  }
  await db.auditLog.create({ data: { orgId, userId, action: `campaign.${action}`, target: c.id } });
}

/** Only failures Meta calls temporary are retried; a new attempt number gives the send a new idempotency key. */
export async function retryFailed(db: PrismaClient, orgId: string, campaignId: string, userId?: string) {
  const c = await db.campaign.findFirst({ where: { id: campaignId, orgId } });
  if (!c) throw new Error("Campaign not found.");
  const failed = await db.campaignRecipient.findMany({ where: { campaignId, status: "failed", errorCode: { not: null } } });
  const retryable = failed.filter((r) => RETRYABLE_CODES.has(r.errorCode!));
  for (const r of retryable)
    await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "pending", attempt: { increment: 1 }, outboundId: null, errorCode: null } });
  if (retryable.length && (c.status === "completed" || c.status === "running"))
    await db.campaign.update({ where: { id: c.id }, data: { status: "running", completedAt: null } });
  await db.auditLog.create({ data: { orgId, userId, action: "campaign.retry_failed", target: c.id, meta: { retried: retryable.length, notRetryable: failed.length - retryable.length } } });
  return { retried: retryable.length, notRetryable: failed.length - retryable.length };
}

const publicUrl = () => (process.env.PUBLIC_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3100").replace(/\/$/, "");

export async function dispatchTick(db: PrismaClient, jobs: Jobs, now = new Date()) {
  await db.campaign.updateMany({ where: { status: "scheduled", scheduledAt: { lte: now } }, data: { status: "running", startedAt: now } });
  const running = await db.campaign.findMany({ where: { status: "running" } });
  let queued = 0;
  for (const c of running) {
    const perTick = Math.max(1, Math.ceil((c.throttlePerMinute * DISPATCH_MS) / 60_000));
    const inFlight = await db.outboundMessage.count({ where: { campaignId: c.id, status: { in: ["queued", "sending"] } } });
    const budget = perTick - inFlight;
    if (budget <= 0) continue;
    const batch = await db.campaignRecipient.findMany({
      where: { campaignId: c.id, status: "pending" }, take: budget, orderBy: { id: "asc" },
      include: { contact: { include: { attributes: true } } },
    });
    if (!batch.length && !inFlight) {
      await db.campaign.update({ where: { id: c.id }, data: { status: "completed", completedAt: now } });
      await jobs.publish(c.orgId, { type: "campaign", id: c.id });
      continue;
    }
    const variants = c.variants as Variant[];
    const templates = new Map((await db.template.findMany({ where: { id: { in: variants.map((v) => v.templateId) }, waba: { orgId: c.orgId } } })).map((t) => [t.id, t]));
    for (const r of batch) {
      const v = variants[r.variant] ?? variants[0];
      const t = templates.get(v.templateId);
      const skip = (reason: string) => db.campaignRecipient.update({ where: { id: r.id }, data: { status: "skipped", skipReason: reason } });
      if (!t) { await skip("template missing"); continue; }
      const utm = (c.utm ?? {}) as Record<string, string>;
      const linkRows: Prisma.TrackedLinkCreateManyInput[] = [];
      const makeLink = (target: string) => {
        const u = new URL(target);
        for (const [k, val] of Object.entries(utm)) if (val) u.searchParams.set(`utm_${k}`, val);
        const code = randomBytes(6).toString("base64url");
        linkRows.push({ code, orgId: c.orgId, campaignId: c.id, recipientId: r.id, url: u.toString() });
        return code;
      };
      let rendered;
      try {
        const values = Object.fromEntries(Object.entries(v.variables).map(([slot, spec]) => [slot, resolveValue(spec, r.contact, makeLink)]));
        rendered = renderTemplate(t, values);
      } catch (e) {
        await skip(e instanceof Error ? e.message : "could not fill the template");
        continue;
      }
      try {
        if (linkRows.length) await db.trackedLink.createMany({ data: linkRows });
        const o = await enqueueSend(db, jobs, {
          orgId: c.orgId, phoneNumberId: c.phoneNumberId, contactId: r.contactId, kind: "template",
          payload: { ...rendered.payload, _preview: rendered.preview, _links: linkRows.map((l) => `${publicUrl()}/r/${l.code}`) },
          category: ((t.category ?? "MARKETING").toLowerCase()) as "marketing", source: "campaign", campaignId: c.id,
          idempotencyKey: `campaign:${c.id}:${r.contactId}:${r.attempt}`,
        });
        await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "queued", outboundId: o.id } });
        queued++;
      } catch (e) {
        if (!(e instanceof SendRefused)) throw e;
        await skip(e.message);
      }
    }
    await jobs.publish(c.orgId, { type: "campaign", id: c.id });
  }
  return queued;
}

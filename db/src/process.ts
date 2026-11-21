/**
 * Turns one stored Meta webhook event into rows. Safe to run twice on the same event:
 * messages are keyed by wamid, statuses by (wamid, status), alerts by a key derived from
 * the event id, so a replay or a Meta redelivery adds nothing.
 */
import { Prisma, type PrismaClient, type Waba } from "@prisma/client";
import { createHash } from "node:crypto";
import { WINDOW_MS } from "./window";
import { limitLabel, templateReason } from "./labels";
import { noJobs, type Jobs } from "./jobs";
import { applyOptIn, applyOptOut, matchesKeyword } from "./optout";
import { emit } from "./outhooks";
import { enqueueSend, SendRefused } from "./send";
import { redact } from "./redact";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined);
const digits = (v: unknown) => (str(v) ?? "").replace(/\D/g, "");
const tsDate = (v: unknown) => {
  const n = Number(str(v));
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

/** Forward-only: a late `sent` never undoes `read`; `failed` never erases a delivery. */
export function nextStatus(current: string | null | undefined, incoming: string): string | null {
  if (incoming === "failed") return current === "delivered" || current === "read" || current === "failed" ? null : "failed";
  if (!(incoming in RANK)) return null; // deleted, warning, etc: kept in MessageStatus only
  if (current === "failed") return null;
  return (RANK[incoming] ?? 0) > (RANK[current ?? ""] ?? 0) ? incoming : null;
}

/** One-line text for the inbox list. Media is referenced by id; downloading it is Phase 2. */
export function summarizeInbound(m: Obj): string {
  const type = str(m.type) ?? "unknown";
  const part = obj(m[type]);
  switch (type) {
    case "text":
      return str(obj(m.text).body) ?? "";
    case "image": case "video": case "document": case "audio": case "sticker":
      return str(part.caption) ?? str(part.filename) ?? `[${type}]`;
    case "location":
      return str(part.name) ?? str(part.address) ?? `[location ${str(part.latitude)},${str(part.longitude)}]`;
    case "contacts":
      return `[contact: ${arr(m.contacts).map((c) => str(obj(obj(c).name).formatted_name)).filter(Boolean).join(", ") || "card"}]`;
    case "interactive": {
      const r = obj(part.button_reply ?? part.list_reply ?? part.nfm_reply);
      return str(r.title) ?? str(r.body) ?? "[interactive reply]";
    }
    case "button":
      return str(obj(m.button).text) ?? "[button]";
    case "reaction":
      return str(obj(m.reaction).emoji) ?? "[reaction removed]";
    default:
      return `[${type}]`;
  }
}

function isUnique(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function upsertAlert(db: PrismaClient, data: Prisma.AlertUncheckedCreateInput) {
  await db.alert.upsert({ where: { dedupeKey: data.dedupeKey }, create: data, update: {} });
}

async function conversationFor(db: PrismaClient, waba: Waba, phoneId: string, waId: string, name?: string) {
  const contact = await db.contact.upsert({
    where: { orgId_waId: { orgId: waba.orgId, waId } },
    create: { orgId: waba.orgId, waId, profileName: name, isFixture: waba.isFixture },
    update: name ? { profileName: name } : {},
  });
  return db.conversation.upsert({
    where: { phoneNumberId_contactId: { phoneNumberId: phoneId, contactId: contact.id } },
    create: { orgId: waba.orgId, phoneNumberId: phoneId, contactId: contact.id },
    update: {},
    include: { contact: true },
  });
}

const MEDIA_TYPES = new Set(["image", "video", "document", "audio", "sticker"]);

/** Opt-out / opt-in keywords and Meta's marketing opt-out button run before any automation. */
async function handleConsent(db: PrismaClient, jobs: Jobs, waba: Waba, conv: { id: string; contactId: string; phoneNumberId: string; contact: { optInStatus: string } }, m: Obj, body: string, wamid: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: waba.orgId } });
  const reply = obj(obj(m.interactive).button_reply);
  const candidates = [body, str(obj(m.button).text), str(obj(m.button).payload), str(reply.title), str(reply.id)].filter(Boolean) as string[];
  if (candidates.some((c) => matchesKeyword(c, org.optOutKeywords))) {
    if (conv.contact.optInStatus !== "opted_out") {
      await applyOptOut(db, { orgId: waba.orgId, contactId: conv.contactId, source: `keyword: ${body.slice(0, 40)}` });
      await emit(db, jobs, waba.orgId, "contact.opted_out", { contactId: conv.contactId, source: "keyword" });
      if (org.optOutReply)
        await enqueueSend(db, jobs, {
          orgId: waba.orgId, phoneNumberId: conv.phoneNumberId, contactId: conv.contactId, kind: "text", category: "service", source: "optout",
          payload: { type: "text", text: { body: org.optOutReply }, _preview: org.optOutReply }, idempotencyKey: `optout:${wamid}`,
        }).catch((e) => { if (!(e instanceof SendRefused)) throw e; });
    }
    return "opted_out";
  }
  if (candidates.some((c) => matchesKeyword(c, org.optInKeywords))) {
    await applyOptIn(db, { orgId: waba.orgId, contactId: conv.contactId, source: "keyword", proof: `WhatsApp message ${wamid}` });
    await emit(db, jobs, waba.orgId, "contact.opted_in", { contactId: conv.contactId, source: "keyword" });
    return "opted_in";
  }
  return null;
}

async function handleMessages(db: PrismaClient, jobs: Jobs, waba: Waba, value: Obj, notes: string[]) {
  const metaPhoneId = str(obj(value.metadata).phone_number_id);
  const phone = metaPhoneId
    ? await db.phoneNumber.findFirst({ where: { metaPhoneNumberId: metaPhoneId, wabaId: waba.id } })
    : null;
  if (!phone) {
    notes.push(`unknown phone number ${metaPhoneId ?? "(none)"}`);
    return;
  }
  const names = new Map(arr(value.contacts).map((c) => [digits(obj(c).wa_id), str(obj(obj(c).profile).name)]));

  for (const raw of arr(value.messages)) {
    const m = obj(raw);
    const wamid = str(m.id);
    const from = digits(m.from);
    if (!wamid || !from) continue;
    if (await db.message.findUnique({ where: { wamid }, select: { id: true } })) continue;
    const ts = tsDate(m.timestamp);
    const conv = await conversationFor(db, waba, phone.id, from, names.get(from));
    const opensWindow = !conv.lastInboundAt || ts.getTime() - conv.lastInboundAt.getTime() >= WINDOW_MS;
    const type = str(m.type) ?? "unknown";
    const body = summarizeInbound(m);
    const media = MEDIA_TYPES.has(type) ? obj(m[type]) : {};
    const isTest = waba.isFixture || phone.isFixture;
    let created;
    try {
      [created] = await db.$transaction([
        db.message.create({
          data: {
            orgId: waba.orgId, wamid, phoneNumberId: phone.id, conversationId: conv.id, direction: "IN",
            type, body, payload: m as Prisma.InputJsonObject, opensWindow, timestamp: ts, isTest,
            ...(str(media.id) ? { mediaId: str(media.id), mediaMime: str(media.mime_type), mediaName: str(media.filename),
              ...(isTest ? { mediaStatus: "unavailable", errorTitle: "Test account: there is no file at Meta to download." } : { mediaStatus: "pending" }) } : {}),
          },
        }),
        // only ever moves forward, so an older message arriving late cannot shrink the window
        db.conversation.updateMany({
          where: { id: conv.id, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: ts } }] },
          data: { lastInboundAt: ts },
        }),
        db.conversation.updateMany({
          where: { id: conv.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: ts } }] },
          data: { lastMessageAt: ts, lastMessagePreview: body.slice(0, 140) },
        }),
        db.conversation.update({ where: { id: conv.id }, data: { unread: { increment: 1 }, status: "open", closedAt: null } }),
      ]);
    } catch (e) {
      if (!isUnique(e)) throw e; // a concurrent run already stored it
      continue;
    }
    // a reply to a campaign: credit the newest campaign message this contact got in the last 72 hours
    const recent = await db.campaignRecipient.findFirst({
      where: { contactId: conv.contactId, campaign: { orgId: waba.orgId }, status: { in: ["sent", "delivered", "read"] }, repliedAt: null, updatedAt: { gte: new Date(ts.getTime() - 72 * 3_600_000) } },
      orderBy: { updatedAt: "desc" },
    });
    if (recent) await db.campaignRecipient.update({ where: { id: recent.id }, data: { repliedAt: ts } });
    const consent = await handleConsent(db, jobs, waba, conv, m, body, wamid);
    if (created.mediaId && !isTest) await jobs.media(created.id);
    if (!consent) await jobs.automation(created.id); // STOP / START never reach automations
    await emit(db, jobs, waba.orgId, "message.received", { messageId: created.id, conversationId: conv.id, from: `+${from}`, type, text: body, test: isTest });
    await jobs.publish(waba.orgId, { type: "message", conversationId: conv.id });
  }

  for (const raw of arr(value.statuses)) {
    const s = obj(raw);
    const wamid = str(s.id);
    const status = str(s.status);
    if (!wamid || !status) continue;
    const ts = tsDate(s.timestamp);
    const err = obj(arr(s.errors)[0]);
    const errorCode = typeof err.code === "number" ? err.code : undefined;
    const pricing = obj(s.pricing);
    const billable = typeof pricing.billable === "boolean" ? pricing.billable : undefined;
    const category = str(pricing.category);

    try {
      await db.messageStatus.create({
        data: {
          wamid, status, timestamp: ts, errorCode, errorTitle: str(err.title) ?? str(err.message),
          pricingCategory: category, pricingType: str(pricing.type), billable,
        },
      });
    } catch (e) {
      if (!isUnique(e)) throw e;
      continue; // this exact status was already applied
    }

    const recipient = digits(s.recipient_id);
    const conv = recipient ? await conversationFor(db, waba, phone.id, recipient) : null;
    const found = await db.message.findUnique({ where: { wamid } });
    if (found && found.phoneNumberId !== phone.id) {
      notes.push(`status for ${wamid} ignored: it belongs to another number`); // never touch another workspace's message
      continue;
    }
    const existing = found;
    const pricingData = { ...(category ? { pricingCategory: category } : {}), ...(billable !== undefined ? { billable } : {}) };
    if (!existing) {
      // Sent by another system on this number (e.g. the bot); we only learn of it from its receipts.
      try {
        await db.message.create({
          data: {
            orgId: waba.orgId, wamid, phoneNumberId: phone.id, conversationId: conv?.id, direction: "OUT", type: "unknown",
            status: nextStatus(null, status), errorCode, timestamp: ts, ...pricingData,
          },
        });
        continue;
      } catch (e) {
        if (!isUnique(e)) throw e;
      }
    }
    const cur = existing ?? (await db.message.findUnique({ where: { wamid } }));
    const next = nextStatus(cur?.status, status);
    await db.message.update({
      where: { wamid },
      data: {
        ...(next ? { status: next } : {}),
        ...(next === "failed" ? { errorCode } : {}),
        ...(cur && !cur.conversationId && conv ? { conversationId: conv.id } : {}),
        ...pricingData,
      },
    });
    if (next) {
      // campaign recipients follow the same forward-only order
      const r = await db.campaignRecipient.findFirst({ where: { wamid, campaign: { orgId: waba.orgId } } });
      if (r) {
        const rn = nextStatus(["sent", "delivered", "read", "failed"].includes(r.status) ? r.status : null, status);
        if (rn) await db.campaignRecipient.update({ where: { id: r.id }, data: { status: rn, ...(rn === "failed" ? { errorCode } : {}) } });
      }
      if (next === "failed" && errorCode === 131050 && cur?.conversationId) {
        const c = await db.conversation.findUnique({ where: { id: cur.conversationId } });
        if (c) await applyOptOut(db, { orgId: waba.orgId, contactId: c.contactId, source: "meta: user stopped marketing messages (131050)" });
      }
      await emit(db, jobs, waba.orgId, "message.status", { wamid, status: next, errorCode: errorCode ?? null });
      await jobs.publish(waba.orgId, { type: "status", conversationId: cur?.conversationId ?? null });
    }
  }
}

/** user_preferences webhook (rolling out): a user stopped or resumed marketing messages inside WhatsApp. */
async function handleUserPreferences(db: PrismaClient, jobs: Jobs, waba: Waba, value: Obj, notes: string[]) {
  const prefs = arr(value.user_preferences).length ? arr(value.user_preferences) : [value];
  for (const raw of prefs) {
    const p = obj(raw);
    const waId = digits(p.wa_id);
    if (!waId || str(p.category) !== "marketing_messages") continue;
    const contact = await db.contact.findUnique({ where: { orgId_waId: { orgId: waba.orgId, waId } } });
    if (!contact) { notes.push(`preference for unknown contact ${waId}`); continue; }
    if (str(p.value) === "stop") {
      await applyOptOut(db, { orgId: waba.orgId, contactId: contact.id, source: "meta: user_preferences stop", at: tsDate(p.timestamp) });
      await emit(db, jobs, waba.orgId, "contact.opted_out", { contactId: contact.id, source: "user_preferences" });
    } else {
      // resuming on WhatsApp is not consent we recorded, so it does not opt them back in
      notes.push(`contact ${contact.id} resumed marketing messages in WhatsApp; opt-in unchanged`);
    }
  }
}

async function handleTemplate(db: PrismaClient, jobs: Jobs, waba: Waba, field: string, value: Obj, key: string) {
  const metaTemplateId = str(value.message_template_id);
  if (!metaTemplateId) return;
  const name = str(value.message_template_name) ?? metaTemplateId;
  const where = { wabaId_metaTemplateId: { wabaId: waba.id, metaTemplateId } };
  const base = { wabaId: waba.id, metaTemplateId, name, language: str(value.message_template_language) };

  if (field === "message_template_quality_update") {
    const quality = str(value.new_quality_score);
    await db.template.upsert({ where, create: { ...base, status: "UNKNOWN", quality }, update: { quality } });
    if (quality === "RED" || quality === "YELLOW") {
      await upsertAlert(db, {
        orgId: waba.orgId, dedupeKey: key, kind: "template", severity: quality === "RED" ? "critical" : "warning",
        title: `Template ${name} quality fell to ${quality === "RED" ? "low" : "medium"}`,
        detail: `Was ${str(value.previous_quality_score) ?? "unknown"}.`,
      });
    }
    return;
  }

  const event = str(value.event) ?? "UNKNOWN";
  const reason = str(value.reason);
  await db.template.upsert({
    where, create: { ...base, status: event, reason }, update: { status: event, reason, language: base.language },
  });
  await emit(db, jobs, waba.orgId, "template.status", { name, status: event, reason: reason ?? null });
  const severity = ({ REJECTED: "critical", DISABLED: "critical", PAUSED: "warning", FLAGGED: "warning" } as Record<string, string>)[event];
  if (severity) {
    await upsertAlert(db, {
      orgId: waba.orgId, dedupeKey: key, kind: "template", severity,
      title: `Template ${name} ${event.toLowerCase()}`,
      detail: templateReason(reason),
    });
  }
}

async function handlePhoneQuality(db: PrismaClient, waba: Waba, value: Obj, key: string, notes: string[]) {
  const display = digits(value.display_phone_number);
  const phones = await db.phoneNumber.findMany({ where: { wabaId: waba.id } });
  const phone = phones.find((p) => digits(p.displayPhoneNumber) === display);
  if (!phone) {
    notes.push(`quality update for unknown number ${display}`);
    return;
  }
  const event = str(value.event) ?? "UNKNOWN";
  const limit = str(value.current_limit) ?? str(obj(value.max_daily_conversations_per_business).current_limit);
  // FLAGGED means the number's quality fell to low; UNFLAGGED clears it but Meta does not say to what, so it stays unknown until the next sync.
  const qualityRating = event === "FLAGGED" ? "RED" : event === "UNFLAGGED" ? "UNKNOWN" : undefined;
  await db.phoneNumber.update({ where: { id: phone.id }, data: { ...(limit ? { messagingLimit: limit } : {}), ...(qualityRating ? { qualityRating } : {}) } });
  const severity = event === "FLAGGED" || event === "DOWNGRADE" ? "warning" : "info";
  const what = ({ FLAGGED: "quality flagged as low", UNFLAGGED: "quality flag cleared", DOWNGRADE: "messaging limit lowered", UPGRADE: "messaging limit raised" } as Record<string, string>)[event] ?? event.toLowerCase();
  await upsertAlert(db, {
    orgId: waba.orgId, phoneNumberId: phone.id, dedupeKey: key, kind: "quality", severity,
    title: `${phone.displayPhoneNumber}: ${what}`,
    detail: [
      event === "FLAGGED" ? "Meta may lower the messaging limit if quality stays low." : undefined,
      limit ? `Messaging limit: ${limitLabel(limit)} (Meta code: ${limit}).` : undefined,
    ].filter(Boolean).join(" ") || undefined,
  });
}

// "INCREASED_CAPABILITIES_ELIGIBILITY" -> "Increased capabilities eligibility"
const humanize = (s?: string) => s && (s.charAt(0) + s.slice(1).toLowerCase()).replace(/_/g, " ");

async function handleAccount(db: PrismaClient, waba: Waba, field: string, value: Obj, key: string) {
  const sev = (str(value.alert_severity) ?? "").toUpperCase();
  await upsertAlert(db, {
    orgId: waba.orgId, dedupeKey: key, kind: "account",
    severity: sev === "CRITICAL" ? "critical" : sev === "WARNING" || field === "account_update" ? "warning" : "info",
    title: humanize(str(value.alert_type) ?? str(value.event)) ?? field,
    detail: str(value.alert_description) ?? str(obj(value.violation_info).violation_type) ?? undefined,
  });
}

export async function processEvent(db: PrismaClient, eventId: string, jobs: Jobs = noJobs): Promise<"done" | "skipped"> {
  const ev = await db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.processedAt) return "skipped";
  const notes: string[] = [];
  try {
    const body = obj(JSON.parse(ev.rawBody));
    if (body.object !== "whatsapp_business_account") notes.push(`ignored object ${str(body.object) ?? "(none)"}`);
    else {
      for (const entry of arr(body.entry)) {
        const wabaId = str(obj(entry).id);
        const waba = wabaId ? await db.waba.findUnique({ where: { metaWabaId: wabaId } }) : null;
        if (!waba) {
          notes.push(`unknown WABA ${wabaId ?? "(none)"}`);
          continue;
        }
        for (const c of arr(obj(entry).changes)) {
          const field = str(obj(c).field) ?? "";
          const value = obj(obj(c).value);
          // Content-based, so the same notification redelivered with different bytes still makes one alert.
          const key = `${field}:${waba.id}:` + createHash("sha256").update(JSON.stringify([value, obj(entry).time ?? null])).digest("hex").slice(0, 32);
          if (field === "messages") await handleMessages(db, jobs, waba, value, notes);
          else if (field === "message_template_status_update" || field === "message_template_quality_update")
            await handleTemplate(db, jobs, waba, field, value, key);
          else if (field === "user_preferences") await handleUserPreferences(db, jobs, waba, value, notes);
          else if (field === "phone_number_quality_update") await handlePhoneQuality(db, waba, value, key, notes);
          else if (field === "account_alerts" || field === "account_update") await handleAccount(db, waba, field, value, key);
          else notes.push(`stored, not processed: ${field}`);
        }
      }
    }
    await db.webhookEvent.update({
      where: { id: ev.id },
      data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: null, note: notes.join("; ") || null },
    });
    return "done";
  } catch (e) {
    await db.webhookEvent.update({
      where: { id: ev.id },
      data: { attempts: { increment: 1 }, lastError: redact(e).slice(0, 500) },
    });
    throw e;
  }
}

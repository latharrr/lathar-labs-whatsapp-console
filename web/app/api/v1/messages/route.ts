import { prisma } from "@ll/db";
import { normalizePhone } from "@ll/db/src/contacts";
import { enqueueSend } from "@ll/db/src/send";
import { renderTemplate } from "@ll/db/src/templates";
import { apiAudit, apiAuth, body, fail, guard, json } from "@/lib/api";
import { webJobs } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type In = { to?: string; from?: string; type?: "text" | "template"; text?: string; template?: { name: string; language?: string; values?: Record<string, string> }; idempotencyKey?: string };

/** POST /api/v1/messages — send a text (inside the 24h window) or an approved template. Same rules as the inbox. */
export async function POST(req: Request) {
  return guard(async () => {
    const a = await apiAuth(req, "messages:send");
    if (a.error) return a.error;
    const orgId = a.key.orgId;
    const b = await body<In>(req);
    if (!b) return fail(400, "Body must be JSON.");
    const waId = normalizePhone(b.to ?? "");
    if (!waId) return fail(400, "to: an E.164 phone number, like +919876543210.");
    if (!b.idempotencyKey || !/^[\w.:-]{6,100}$/.test(b.idempotencyKey)) return fail(400, "idempotencyKey: 6-100 characters, unique per message, so a retried request is not sent twice.");
    const phone = await prisma.phoneNumber.findFirst({ where: { waba: { orgId }, ...(b.from ? { OR: [{ id: b.from }, { metaPhoneNumberId: b.from }] } : {}) }, orderBy: { displayPhoneNumber: "asc" } });
    if (!phone) return fail(400, "from: no such number in this workspace.");
    const contact = await prisma.contact.upsert({ where: { orgId_waId: { orgId, waId } }, create: { orgId, waId }, update: {} });
    await prisma.conversation.upsert({ where: { phoneNumberId_contactId: { phoneNumberId: phone.id, contactId: contact.id } }, create: { orgId, phoneNumberId: phone.id, contactId: contact.id }, update: {} });
    let row;
    if (b.type === "template") {
      const t = await prisma.template.findFirst({ where: { wabaId: phone.wabaId, name: b.template?.name ?? "", status: "APPROVED", ...(b.template?.language ? { language: b.template.language } : {}) } });
      if (!t) return fail(422, "template: no approved template with that name (and language) on this number.");
      let r;
      try { r = renderTemplate(t, b.template?.values ?? {}); } catch (e) { return fail(422, `template.values: ${e instanceof Error ? e.message : "invalid"}`); }
      row = await enqueueSend(prisma, webJobs, { orgId, phoneNumberId: phone.id, contactId: contact.id, kind: "template", category: (t.category ?? "UTILITY").toLowerCase() as "utility", source: "api", payload: { ...r.payload, _preview: r.preview }, idempotencyKey: `api:${orgId}:${b.idempotencyKey}` });
    } else if (b.type === "text") {
      if (!b.text?.trim() || b.text.length > 4096) return fail(400, "text: 1 to 4096 characters.");
      row = await enqueueSend(prisma, webJobs, { orgId, phoneNumberId: phone.id, contactId: contact.id, kind: "text", category: "service", source: "api", payload: { type: "text", text: { body: b.text }, _preview: b.text }, idempotencyKey: `api:${orgId}:${b.idempotencyKey}` });
    } else return fail(400, 'type: "text" or "template".');
    await apiAudit(orgId, a.key.id, "message.send", row.id, { type: b.type });
    return json(202, { id: row.id, status: row.status });
  });
}

/** GET /api/v1/messages?id=... — where a message is in the outbox. */
export async function GET(req: Request) {
  return guard(async () => {
    const a = await apiAuth(req, "read");
    if (a.error) return a.error;
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const o = await prisma.outboundMessage.findFirst({ where: { id, orgId: a.key.orgId } });
    if (!o) return fail(404, "Not found.");
    const m = o.wamid ? await prisma.message.findUnique({ where: { wamid: o.wamid }, select: { status: true, errorCode: true } }) : null;
    return json(200, { id: o.id, outbox: o.status, delivery: m?.status ?? null, errorCode: o.errorCode ?? m?.errorCode ?? null, error: o.errorMessage, wamid: o.wamid });
  });
}

import { prisma } from "@ll/db";
import { normalizePhone } from "@ll/db/src/contacts";
import { applyOptIn } from "@ll/db/src/optout";
import { apiAudit, apiAuth, body, fail, guard, json } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type In = { phone?: string; name?: string; email?: string; attributes?: Record<string, string>; tags?: string[]; optIn?: { source: string; proof: string } };

/** POST /api/v1/contacts — create or update by phone. An opt-in needs a source and proof, and never overrides an opt-out. */
export async function POST(req: Request) {
  return guard(async () => {
    const a = await apiAuth(req, "contacts:write");
    if (a.error) return a.error;
    const orgId = a.key.orgId;
    const b = await body<In>(req);
    const waId = normalizePhone(b?.phone ?? "");
    if (!b || !waId) return fail(400, "phone: an E.164 phone number.");
    if (b.optIn && (!b.optIn.source || !b.optIn.proof)) return fail(400, "optIn needs source and proof.");
    const c = await prisma.contact.upsert({ where: { orgId_waId: { orgId, waId } }, create: { orgId, waId, name: b.name ?? null, email: b.email ?? null }, update: { ...(b.name ? { name: b.name } : {}), ...(b.email ? { email: b.email } : {}) } });
    for (const [key, value] of Object.entries(b.attributes ?? {}).slice(0, 50)) {
      const k = key.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
      await prisma.contactAttribute.upsert({ where: { contactId_key: { contactId: c.id, key: k } }, create: { contactId: c.id, key: k, value: String(value).slice(0, 500) }, update: { value: String(value).slice(0, 500) } });
    }
    for (const name of (b.tags ?? []).slice(0, 20)) {
      const tag = await prisma.tag.upsert({ where: { orgId_name: { orgId, name: name.slice(0, 40) } }, create: { orgId, name: name.slice(0, 40) }, update: {} });
      await prisma.contactTag.upsert({ where: { contactId_tagId: { contactId: c.id, tagId: tag.id } }, create: { contactId: c.id, tagId: tag.id }, update: {} });
    }
    if (b.optIn && c.optInStatus !== "opted_out") await applyOptIn(prisma, { orgId, contactId: c.id, source: `api: ${b.optIn.source}`, proof: b.optIn.proof });
    await apiAudit(orgId, a.key.id, "contact.upsert", c.id);
    const out = await prisma.contact.findUniqueOrThrow({ where: { id: c.id } });
    return json(200, { id: out.id, phone: `+${out.waId}`, optInStatus: out.optInStatus });
  });
}

/** GET /api/v1/contacts?phone=... */
export async function GET(req: Request) {
  return guard(async () => {
    const a = await apiAuth(req, "read");
    if (a.error) return a.error;
    const waId = normalizePhone(new URL(req.url).searchParams.get("phone") ?? "");
    if (!waId) return fail(400, "phone: an E.164 phone number.");
    const c = await prisma.contact.findUnique({ where: { orgId_waId: { orgId: a.key.orgId, waId } }, include: { attributes: true, tags: { include: { tag: true } } } });
    if (!c) return fail(404, "Not found.");
    await apiAudit(a.key.orgId, a.key.id, "pii.view", c.id);
    return json(200, { id: c.id, phone: `+${c.waId}`, name: c.name ?? c.profileName, email: c.email, optInStatus: c.optInStatus, blocked: c.blocked, attributes: Object.fromEntries(c.attributes.map((x) => [x.key, x.value])), tags: c.tags.map((t) => t.tag.name) });
  });
}

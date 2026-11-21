import { prisma, type Prisma } from "@ll/db";
import { toCsv } from "@ll/db/src/contacts";
import { segmentWhere, type Rules } from "@ll/db/src/segments";
import { audit } from "@/lib/audit";
import { can } from "@ll/db/src/permissions";
import { requireMember } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV export (Owner/Admin). Logged as personal-data access. */
export async function GET(req: Request) {
  const m = await requireMember();
  if (!can(m.role, "contacts.export")) return Response.json({ error: "Only Owners and Admins can export." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const seg = sp.get("segment") ? await prisma.segment.findFirst({ where: { id: sp.get("segment")!, orgId: m.orgId } }) : null;
  const view = sp.get("view");
  const where: Prisma.ContactWhereInput = { AND: [
    seg ? segmentWhere(m.orgId, seg.rules as Rules) : { orgId: m.orgId },
    view === "blocked" ? { blocked: true } : view && view !== "all" ? { optInStatus: view } : {},
    sp.get("tag") ? { tags: { some: { tag: { name: sp.get("tag")! } } } } : {},
  ] };
  const rows = await prisma.contact.findMany({ where, include: { attributes: true, tags: { include: { tag: true } } }, orderBy: { createdAt: "asc" }, take: 100_000 });
  const keys = [...new Set(rows.flatMap((r) => r.attributes.map((a) => a.key)))].sort();
  const csv = toCsv([
    ["phone", "name", "whatsapp_name", "email", "marketing_opt_in", "opt_in_source", "opt_in_proof", "opt_in_at", "opt_out_at", "blocked", "tags", "test_contact", ...keys],
    ...rows.map((r) => [`+${r.waId}`, r.name, r.profileName, r.email, r.optInStatus, r.optInSource, r.optInProof, r.optInAt?.toISOString(), r.optOutAt?.toISOString(), r.blocked, r.tags.map((t) => t.tag.name).join("|"), r.isFixture, ...keys.map((k) => r.attributes.find((a) => a.key === k)?.value)]),
  ]);
  await audit(m, "pii.export", undefined, { contacts: rows.length });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}

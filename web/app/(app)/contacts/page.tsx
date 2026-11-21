import Link from "next/link";
import { prisma, type Prisma } from "@ll/db";
import { can } from "@ll/db/src/permissions";
import { segmentWhere, type Rules } from "@ll/db/src/segments";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Empty, PageHeader, Select, StatusChip, td, th } from "@/components/ui/kit";
import { ago, int } from "@/lib/format";
import { requirePage } from "@/lib/session";
import { createContact } from "./actions";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";
const PAGE = 50;

type SP = { q?: string; view?: string; tag?: string; segment?: string; page?: string; erased?: string };

export default async function ContactsPage({ searchParams: sp }: { searchParams: SP }) {
  const m = await requirePage("contacts.read");
  const page = Math.max(1, Number(sp.page) || 1);
  const [tags, segments] = await Promise.all([
    prisma.tag.findMany({ where: { orgId: m.orgId }, orderBy: { name: "asc" } }),
    prisma.segment.findMany({ where: { orgId: m.orgId }, orderBy: { name: "asc" } }),
  ]);
  const seg = segments.find((s) => s.id === sp.segment);
  const q = sp.q?.trim();
  const where: Prisma.ContactWhereInput = {
    AND: [
      seg ? segmentWhere(m.orgId, seg.rules as Rules) : { orgId: m.orgId },
      sp.view === "blocked" ? { blocked: true } : sp.view && sp.view !== "all" ? { optInStatus: sp.view } : {},
      sp.tag ? { tags: { some: { tag: { name: sp.tag } } } } : {},
      q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { profileName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { waId: { contains: q.replace(/\D/g, "") || q } }] } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.contact.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { tags: { include: { tag: true } }, conversations: { select: { lastMessageAt: true }, orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } }, take: 1 } } }),
    prisma.contact.count({ where }),
  ]);
  const exportQs = new URLSearchParams(Object.entries({ q: sp.q, view: sp.view, tag: sp.tag, segment: sp.segment }).filter(([, v]) => v) as [string, string][]).toString();
  const pageLink = (p: number) => `/contacts?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "page" && k !== "erased")) as Record<string, string>), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Contacts" subtitle={`${int(total)} contact${total === 1 ? "" : "s"}`}
        actions={can(m.role, "contacts.export") ? <a href={`/api/export/contacts${exportQs ? `?${exportQs}` : ""}`} className={buttonClass("secondary")}>Export CSV</a> : undefined} />
      {sp.erased && <p role="status" className="rounded-control bg-ok-bg px-3 py-2 text-sm text-ok">The contact and all their messages were deleted.</p>}
      <Card>
        <form className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]" action="/contacts">
          <label htmlFor="cq" className="sr-only">Search contacts</label>
          <Input id="cq" name="q" data-search defaultValue={sp.q} placeholder="Search name, number or email  ( / )" className="h-9" />
          <label htmlFor="cv" className="sr-only">Opt-in</label>
          <Select id="cv" name="view" defaultValue={sp.view ?? "all"} className="h-9">
            <option value="all">Everyone</option><option value="opted_in">Opted in</option><option value="unknown">No opt-in</option><option value="opted_out">Opted out</option><option value="blocked">Block list</option>
          </Select>
          <label htmlFor="ct" className="sr-only">Tag</label>
          <Select id="ct" name="tag" defaultValue={sp.tag ?? ""} className="h-9"><option value="">Any tag</option>{tags.map((t) => <option key={t.id}>{t.name}</option>)}</Select>
          <label htmlFor="cs" className="sr-only">Segment</label>
          <Select id="cs" name="segment" defaultValue={sp.segment ?? ""} className="h-9"><option value="">Any segment</option>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
      </Card>
      {can(m.role, "contacts.write") && (
        <Card>
          <h2 className="text-sm font-semibold">Add a contact</h2>
          <ActionForm action={createContact} resetOnOk className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label htmlFor="np" className="sr-only">Phone number</label>
            <Input id="np" name="phone" required placeholder="+91 98765 43210" inputMode="tel" className="tnum h-9" />
            <label htmlFor="nn" className="sr-only">Name</label>
            <Input id="nn" name="name" placeholder="Name (optional)" className="h-9" />
            <SubmitButton pending="Adding…" variant="secondary">Add</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">Adding a contact does not record marketing consent. Record it on the contact with its source and proof.</p>
        </Card>
      )}
      {rows.length === 0 ? (
        <Empty title={total === 0 && !q && !sp.view && !sp.tag && !seg ? "No contacts yet" : "No contacts match"} body="Contacts are created when someone writes to your number, when you import a CSV, or through the API." action={can(m.role, "contacts.import") ? <Link href="/contacts/import" className={buttonClass("primary")}>Import CSV</Link> : undefined} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr><th scope="col" className={th}>Name</th><th scope="col" className={th}>Number</th><th scope="col" className={th}>Marketing</th><th scope="col" className={`${th} hidden md:table-cell`}>Tags</th><th scope="col" className={`${th} hidden sm:table-cell`}>Last message</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className={td}><Link href={`/contacts/${c.id}`} className="font-medium underline-offset-2 hover:underline">{c.name ?? c.profileName ?? "Unnamed"}</Link>{c.isFixture && <span className="ml-1 text-xs text-muted">(test)</span>}{c.blocked && <span className="ml-1 text-xs text-err">blocked</span>}</td>
                  <td className={`${td} tnum whitespace-nowrap`}>+{c.waId}</td>
                  <td className={td}><StatusChip status={c.optInStatus} /></td>
                  <td className={`${td} hidden md:table-cell`}>{c.tags.map((t) => t.tag.name).join(", ") || <span className="text-muted">None</span>}</td>
                  <td className={`${td} hidden text-muted sm:table-cell`}>{ago(c.conversations[0]?.lastMessageAt ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > PAGE && (
            <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-sm">
              {page > 1 ? <Link href={pageLink(page - 1)} className={buttonClass("secondary")}>Previous</Link> : <span />}
              <span className="text-muted">Page {page} of {Math.ceil(total / PAGE)}</span>
              {page * PAGE < total ? <Link href={pageLink(page + 1)} className={buttonClass("secondary")}>Next</Link> : <span />}
            </nav>
          )}
        </Card>
      )}
    </>
  );
}

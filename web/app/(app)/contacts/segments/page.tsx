import Link from "next/link";
import { prisma } from "@ll/db";
import { can } from "@ll/db/src/permissions";
import { segmentWhere, type Rules } from "@ll/db/src/segments";
import { ConfirmForm } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader, td, th } from "@/components/ui/kit";
import { int } from "@/lib/format";
import { requirePage } from "@/lib/session";
import { deleteSegment } from "../actions";
import { SegmentBuilder } from "./builder";

export const metadata = { title: "Segments" };
export const dynamic = "force-dynamic";

export default async function SegmentsPage({ searchParams }: { searchParams: { edit?: string } }) {
  const m = await requirePage("contacts.read");
  const segments = await prisma.segment.findMany({ where: { orgId: m.orgId }, orderBy: { name: "asc" } });
  const counts = await Promise.all(segments.map(async (s) => {
    const w = segmentWhere(m.orgId, s.rules as Rules);
    return [await prisma.contact.count({ where: w }), await prisma.contact.count({ where: { AND: [w, { optInStatus: "opted_in", blocked: false }] } })];
  }));
  const editing = segments.find((s) => s.id === searchParams.edit);
  const r = editing?.rules as Rules | undefined;
  return (
    <>
      <PageHeader title="Segments" subtitle="Saved filters for campaigns. Counts update as contacts change." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card className="overflow-x-auto">
          <CardTitle>Saved segments</CardTitle>
          {segments.length === 0 ? <p className="text-sm text-muted">No segments yet. Build one on the right.</p> : (
            <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Name</th><th className={`${th} text-right`}>Contacts</th><th className={`${th} text-right`}>Can get marketing</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{segments.map((s, i) => <tr key={s.id}>
                <td className={td}><Link href={`/contacts?segment=${s.id}`} className="font-medium underline-offset-2 hover:underline">{s.name}</Link></td>
                <td className={`${td} tnum text-right`}>{int(counts[i][0])}</td><td className={`${td} tnum text-right`}>{int(counts[i][1])}</td>
                <td className={`${td} text-right`}>{can(m.role, "contacts.write") && <div className="flex justify-end gap-1"><Link href={`/contacts/segments?edit=${s.id}`} className="inline-flex h-9 items-center rounded-full px-3 text-sm hover:bg-surface">Edit</Link><ConfirmForm action={deleteSegment} hidden={{ id: s.id }} variant="ghost" tone="danger" label="Delete" title={`Delete segment ${s.name}?`} body="Campaigns that used it keep their recipients; the filter itself is removed." confirm="Delete" /></div>}</td>
              </tr>)}</tbody></table>
          )}
        </Card>
        <Card>
          <CardTitle>{editing ? `Edit ${editing.name}` : "New segment"}</CardTitle>
          {can(m.role, "contacts.write") ? <SegmentBuilder key={editing?.id ?? "new"} initial={editing && r ? { id: editing.id, name: editing.name, match: r.match, conditions: r.conditions } : undefined} /> : <p className="text-sm text-muted">Viewers cannot create segments.</p>}
        </Card>
      </div>
    </>
  );
}

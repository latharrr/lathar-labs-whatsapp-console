import Link from "next/link";
import { prisma } from "@ll/db";
import { can } from "@ll/db/src/permissions";
import { LiveRefresh } from "@/components/live";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader, StatusChip, td, th } from "@/components/ui/kit";
import { ago, int } from "@/lib/format";
import { requirePage } from "@/lib/session";

export const metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const m = await requirePage("analytics.read");
  const rows = await prisma.campaign.findMany({ where: { orgId: m.orgId }, orderBy: { createdAt: "desc" }, include: { phoneNumber: { select: { displayPhoneNumber: true, isFixture: true } }, segment: { select: { name: true } } } });
  const counts = await prisma.campaignRecipient.groupBy({ by: ["campaignId", "status"], where: { campaign: { orgId: m.orgId } }, _count: { _all: true } });
  const get = (id: string, ss: string[]) => counts.filter((c) => c.campaignId === id && ss.includes(c.status)).reduce((a, c) => a + c._count._all, 0);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Campaigns" subtitle={<>Broadcasts to opted-in contacts · <LiveRefresh types={["campaign", "status"]} /></>}
        actions={can(m.role, "campaigns.write") ? <Link href="/campaigns/new" className={buttonClass("primary")}>New campaign</Link> : undefined} />
      {rows.length === 0 ? <Empty title="No campaigns yet" body="A campaign sends an approved template to a segment of opted-in contacts, at a pace you set." /> : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className={th}>Name</th><th className={th}>Status</th><th className={`${th} hidden text-right sm:table-cell`}>Sent</th><th className={`${th} hidden text-right sm:table-cell`}>Read</th><th className={`${th} hidden text-right md:table-cell`}>Failed</th><th className={`${th} hidden lg:table-cell`}>Audience</th><th className={`${th} hidden lg:table-cell`}>Created</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td className={td}><Link href={`/campaigns/${c.id}`} className="font-medium underline-offset-2 hover:underline">{c.name}</Link><span className="block text-xs text-muted">{c.phoneNumber.displayPhoneNumber}{c.phoneNumber.isFixture ? " · test account" : ""}</span></td>
                <td className={td}><StatusChip status={c.status} /></td>
                <td className={`${td} tnum hidden text-right sm:table-cell`}>{int(get(c.id, ["sent", "delivered", "read"]))}</td>
                <td className={`${td} tnum hidden text-right sm:table-cell`}>{int(get(c.id, ["read"]))}</td>
                <td className={`${td} tnum hidden text-right md:table-cell`}>{int(get(c.id, ["failed"]))}</td>
                <td className={`${td} hidden lg:table-cell`}>{c.segment?.name ?? "All contacts"}</td>
                <td className={`${td} hidden text-muted lg:table-cell`}>{ago(c.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

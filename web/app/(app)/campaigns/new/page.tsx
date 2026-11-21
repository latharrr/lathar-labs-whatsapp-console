import { prisma } from "@ll/db";
import { fromComponents, slots } from "@ll/db/src/templates";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";
import { CampaignWizard } from "./wizard";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const m = await requirePage("campaigns.write");
  const [phones, templates, segments, attrs] = await Promise.all([
    prisma.phoneNumber.findMany({ where: { waba: { orgId: m.orgId } }, include: { waba: { select: { isFixture: true } } } }),
    prisma.template.findMany({ where: { waba: { orgId: m.orgId }, status: "APPROVED" }, orderBy: { name: "asc" } }),
    prisma.segment.findMany({ where: { orgId: m.orgId }, orderBy: { name: "asc" } }),
    prisma.contactAttribute.findMany({ where: { contact: { orgId: m.orgId } }, distinct: ["key"], select: { key: true } }),
  ]);
  if (!phones.length) return <Empty title="No number connected" body="Connect a WhatsApp Business Account in Settings first." />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New campaign" subtitle="Nothing is sent until you review and launch it." />
      <Card>
        <CampaignWizard
          phones={phones.map((p) => ({ id: p.id, label: `${p.displayPhoneNumber}${p.verifiedName ? ` · ${p.verifiedName}` : ""}`, wabaId: p.wabaId, isTest: p.isFixture || p.waba.isFixture }))}
          templates={templates.map((t) => ({ id: t.id, name: t.name, wabaId: t.wabaId, category: t.category ?? "MARKETING", slots: slots(t.components), body: fromComponents(t.name, t.language ?? "en", t.category ?? "", t.components).body }))}
          segments={segments.map((s) => ({ id: s.id, name: s.name }))} attrs={attrs.map((a) => a.key)} />
      </Card>
    </div>
  );
}

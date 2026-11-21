import { prisma } from "@ll/db";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";
import { TemplateBuilder } from "../builder";

export const metadata = { title: "New template" };

export default async function NewTemplatePage() {
  const m = await requirePage("templates.write");
  const wabas = await prisma.waba.findMany({ where: { orgId: m.orgId }, select: { id: true, name: true, metaWabaId: true, isFixture: true } });
  if (!wabas.length) return <Empty title="No account connected" body="Connect a WhatsApp Business Account in Settings to create templates." />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New template" subtitle="Save a draft first. Submitting sends it to Meta for review." />
      <Card><TemplateBuilder wabas={wabas.map((w) => ({ id: w.id, name: w.name ?? w.metaWabaId, isFixture: w.isFixture }))} /></Card>
    </div>
  );
}

import { notFound, redirect } from "next/navigation";
import { prisma } from "@ll/db";
import { fromComponents } from "@ll/db/src/templates";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";
import { TemplateBuilder } from "../../builder";

export const metadata = { title: "Edit template" };

export default async function EditTemplatePage({ params }: { params: { id: string } }) {
  const m = await requirePage("templates.write");
  const t = await prisma.template.findFirst({ where: { id: params.id, waba: { orgId: m.orgId } }, include: { waba: true } });
  if (!t) notFound();
  if (t.metaTemplateId) redirect(`/templates/${t.id}`);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`Edit ${t.name}`} subtitle="Each save is kept as a version." />
      <Card><TemplateBuilder id={t.id} wabas={[{ id: t.wabaId, name: t.waba.name ?? t.waba.metaWabaId, isFixture: t.waba.isFixture }]} initial={fromComponents(t.name, t.language ?? "en", t.category ?? "MARKETING", t.components)} /></Card>
    </div>
  );
}

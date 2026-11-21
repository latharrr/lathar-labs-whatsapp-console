import { notFound } from "next/navigation";
import { prisma } from "@ll/db";
import { aiStatus } from "@ll/db/src/ai";
import type { FlowGraph } from "@ll/db/src/automation";
import { can } from "@ll/db/src/permissions";
import { ConfirmForm } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader, StatusChip, td, th } from "@/components/ui/kit";
import { ago } from "@/lib/format";
import { requirePage } from "@/lib/session";
import { deleteFlow } from "../../actions";
import { FlowEditor } from "../../client";

export const metadata = { title: "Flow" };
export const dynamic = "force-dynamic";

export default async function FlowPage({ params }: { params: { id: string } }) {
  const m = await requirePage("analytics.read");
  const flow = await prisma.flow.findFirst({ where: { id: params.id, orgId: m.orgId }, include: { runs: { orderBy: { updatedAt: "desc" }, take: 20, include: { conversation: { include: { contact: { select: { name: true, profileName: true, waId: true } } } } } } } });
  if (!flow) notFound();
  const members = await prisma.membership.findMany({ where: { orgId: m.orgId, role: { in: ["OWNER", "ADMIN", "AGENT"] } }, include: { user: true } });
  const edit = can(m.role, "automations.write");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={flow.name} subtitle="Runs when an automation starts it. A customer reply resumes a flow that is waiting on buttons."
        actions={edit ? <ConfirmForm action={deleteFlow} hidden={{ id: flow.id }} variant="danger" tone="danger" label="Delete flow" title="Delete this flow?" body="Automations that start it will reply with their text only, or do nothing." confirm="Delete" /> : undefined} />
      <Card>{edit ? <FlowEditor id={flow.id} name={flow.name} graph={flow.graph as FlowGraph} members={members.map((x) => ({ id: x.userId, label: x.user.name ?? x.user.email }))} aiReady={aiStatus().ready} />
        : <pre className="overflow-x-auto font-mono text-xs">{JSON.stringify(flow.graph, null, 2)}</pre>}</Card>
      <Card className="overflow-x-auto">
        <CardTitle>Recent runs</CardTitle>
        {flow.runs.length === 0 ? <p className="text-sm text-muted">This flow has not run yet.</p> : (
          <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Contact</th><th className={th}>Status</th><th className={`${th} hidden sm:table-cell`}>At node</th><th className={th}>Updated</th></tr></thead>
            <tbody>{flow.runs.map((r) => <tr key={r.id}><td className={td}>{r.conversation.contact.name ?? r.conversation.contact.profileName ?? `+${r.conversation.contact.waId}`}</td><td className={td}><StatusChip status={r.status} /></td><td className={`${td} hidden font-mono text-xs sm:table-cell`}>{r.currentNode ?? "-"}</td><td className={`${td} text-muted`}>{ago(r.updatedAt)}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  );
}

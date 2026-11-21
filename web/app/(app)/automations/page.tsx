import Link from "next/link";
import { prisma } from "@ll/db";
import { aiStatus } from "@ll/db/src/ai";
import { can } from "@ll/db/src/permissions";
import { slots } from "@ll/db/src/templates";
import { ActionForm, ConfirmForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/field";
import { Empty, PageHeader, td, th } from "@/components/ui/kit";
import { ago } from "@/lib/format";
import { requirePage } from "@/lib/session";
import { createFlow, deleteAutomation, toggleAutomation } from "./actions";
import { AutomationForm } from "./client";

export const metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { keyword: "Keyword", welcome: "Welcome", away: "Away", event: "API event" };

export default async function AutomationsPage() {
  const m = await requirePage("analytics.read");
  const [autos, flows, phones, templates, org] = await Promise.all([
    prisma.automation.findMany({ where: { orgId: m.orgId }, orderBy: [{ kind: "asc" }, { priority: "asc" }], include: { flow: { select: { name: true } } } }),
    prisma.flow.findMany({ where: { orgId: m.orgId }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { runs: true } } } }),
    prisma.phoneNumber.findMany({ where: { waba: { orgId: m.orgId } } }),
    prisma.template.findMany({ where: { waba: { orgId: m.orgId }, status: "APPROVED" } }),
    prisma.organization.findUniqueOrThrow({ where: { id: m.orgId } }),
  ]);
  const edit = can(m.role, "automations.write");
  const ai = aiStatus();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Automations" subtitle={<>Opt-out words ({org.optOutKeywords.join(", ")}) are handled first and never trigger an automation. Business hours: {org.businessHours ? <Link href="/settings/messaging" className="underline">set ({org.timezone})</Link> : <Link href="/settings/messaging" className="underline">not set, so away messages never fire</Link>}.</>} />
      <Card className="overflow-x-auto">
        <CardTitle>Triggers</CardTitle>
        {autos.length === 0 ? <p className="text-sm text-muted">No automations yet. Add one below.</p> : (
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className={th}>Name</th><th className={th}>Trigger</th><th className={`${th} hidden md:table-cell`}>Does</th><th className={`${th} hidden sm:table-cell`}>Last fired</th><th className={th}>State</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{autos.map((a) => {
              const cfg = a.config as { keywords?: string[]; reply?: string; event?: string };
              return (
                <tr key={a.id}>
                  <td className={td}>{a.name}</td>
                  <td className={td}>{KIND[a.kind]}{cfg.keywords && <span className="block text-xs text-muted">{cfg.keywords.join(", ")}</span>}{cfg.event && <span className="block font-mono text-xs text-muted">{cfg.event}</span>}</td>
                  <td className={`${td} hidden max-w-[280px] truncate md:table-cell`}>{a.flow ? `Runs flow ${a.flow.name}` : cfg.reply ?? (a.kind === "event" ? "Sends a template" : "")}</td>
                  <td className={`${td} hidden text-muted sm:table-cell`}>{ago(a.lastFiredAt)}</td>
                  <td className={td}><Chip tone={a.enabled ? "ok" : "neutral"}>{a.enabled ? "On" : "Off"}</Chip></td>
                  <td className={`${td} text-right`}>{edit && <div className="flex justify-end gap-1">
                    <ActionForm action={toggleAutomation}><input type="hidden" name="id" value={a.id} /><SubmitButton variant="ghost" pending="…">{a.enabled ? "Turn off" : "Turn on"}</SubmitButton></ActionForm>
                    <ConfirmForm action={deleteAutomation} hidden={{ id: a.id }} variant="ghost" tone="danger" label="Delete" title={`Delete ${a.name}?`} body="It stops immediately. Messages already sent are not affected." confirm="Delete" />
                  </div>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>New automation</CardTitle>
          {edit ? <AutomationForm phones={phones.map((p) => ({ id: p.id, label: p.displayPhoneNumber + (p.isFixture ? " (test)" : "") }))} flows={flows.map((f) => ({ id: f.id, label: f.name }))} templates={templates.map((t) => ({ id: t.id, name: t.name, slots: slots(t.components) }))} />
            : <p className="text-sm text-muted">Only Owners and Admins can change automations.</p>}
        </Card>
        <Card>
          <CardTitle>Flows</CardTitle>
          <p className="mb-3 text-sm text-muted">Multi-step conversations: messages, buttons, branches, attributes, handoff to an agent, webhook calls and an optional AI reply. AI replies: {ai.detail}</p>
          {flows.length === 0 ? <p className="text-sm text-muted">No flows yet.</p> : (
            <ul className="flex flex-col gap-1.5">{flows.map((f) => <li key={f.id} className="flex items-center justify-between gap-2 text-sm"><Link href={`/automations/flows/${f.id}`} className="underline">{f.name}</Link><span className="text-xs text-muted">{f._count.runs} runs · edited {ago(f.updatedAt)}</span></li>)}</ul>
          )}
          {edit && <ActionForm action={createFlow} className="mt-3 flex gap-2"><label htmlFor="fn" className="sr-only">Flow name</label><Input id="fn" name="name" placeholder="Flow name" className="h-9" /><SubmitButton variant="secondary" pending="…">New flow</SubmitButton></ActionForm>}
        </Card>
      </div>
      {autos.length === 0 && flows.length === 0 && <Empty title="Start with a welcome message" body="A welcome automation answers the first message from every new contact, so nobody waits in silence." />}
    </div>
  );
}

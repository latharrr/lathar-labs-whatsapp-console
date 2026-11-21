import { prisma } from "@ll/db";
import { OUT_EVENTS } from "@ll/db/src/outhooks";
import { can } from "@ll/db/src/permissions";
import { ActionForm, ConfirmForm } from "@/components/action-form";
import { LiveRefresh } from "@/components/live";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { PageHeader, StatusChip, td, th } from "@/components/ui/kit";
import { ago } from "@/lib/format";
import { requirePage } from "@/lib/session";
import { createHook, deleteHook, testHook, toggleHook } from "../actions";
import { SecretForm } from "../secret";

export const metadata = { title: "Outbound webhooks" };
export const dynamic = "force-dynamic";

export default async function HooksPage() {
  const m = await requirePage("analytics.read");
  const hooks = await prisma.outboundWebhook.findMany({ where: { orgId: m.orgId }, orderBy: { createdAt: "asc" }, include: { deliveries: { orderBy: { createdAt: "desc" }, take: 8 } } });
  const manage = can(m.role, "developer.manage");
  return (
    <>
      <PageHeader title="Outbound webhooks" subtitle={<>Forward events to your app or n8n. Each POST carries X-LL-Signature-256 (HMAC-SHA256 of the body). Internal and private addresses are refused. · <LiveRefresh /></>} />
      {hooks.length === 0 && <Card><p className="text-sm text-muted">No webhooks yet.</p></Card>}
      {hooks.map((h) => (
        <Card key={h.id} className="overflow-x-auto">
          <CardTitle aside={<div className="flex flex-wrap gap-1">
            <StatusChip status={h.enabled ? "running" : "paused"} />
            {manage && <><ActionForm action={testHook}><input type="hidden" name="id" value={h.id} /><SubmitButton variant="ghost" pending="…">Send test</SubmitButton></ActionForm>
              <ActionForm action={toggleHook}><input type="hidden" name="id" value={h.id} /><SubmitButton variant="ghost" pending="…">{h.enabled ? "Pause" : "Resume"}</SubmitButton></ActionForm>
              <ConfirmForm action={deleteHook} hidden={{ id: h.id }} variant="ghost" tone="danger" label="Delete" title={`Delete ${h.name}?`} body="Events stop going to this address. Past deliveries are deleted too." confirm="Delete" /></>}
          </div>}>{h.name}</CardTitle>
          <p className="break-all font-mono text-[13px]">{h.url}</p>
          <p className="mt-1 text-xs text-muted">Events: {h.events.join(", ")}</p>
          {h.deliveries.length > 0 && (
            <table className="mt-3 w-full border-collapse text-sm"><thead><tr><th className={th}>Event</th><th className={th}>Result</th><th className={`${th} hidden sm:table-cell`}>Attempts</th><th className={th}>When</th></tr></thead>
              <tbody>{h.deliveries.map((d) => <tr key={d.id}><td className={`${td} font-mono text-[13px]`}>{d.event}</td><td className={td}><StatusChip status={d.status} />{d.error && <span className="block text-xs text-muted">{d.error}</span>}</td><td className={`${td} tnum hidden sm:table-cell`}>{d.attempts}{d.responseCode ? ` · HTTP ${d.responseCode}` : ""}</td><td className={`${td} text-muted`}>{ago(d.createdAt)}</td></tr>)}</tbody></table>
          )}
        </Card>
      ))}
      {manage && (
        <Card>
          <CardTitle>Add a webhook</CardTitle>
          <SecretForm action={createHook}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="hn"><Input id="hn" name="name" placeholder="n8n" /></Field>
              <Field label="URL" htmlFor="hu" hint="https only. Delivered with retries (6 attempts, backing off up to an hour)."><Input id="hu" name="url" type="url" required placeholder="https://n8n.example.com/webhook/…" /></Field>
            </div>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1"><legend className="mb-1 text-sm font-medium">Events</legend>
              {OUT_EVENTS.map((e) => <label key={e} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" name="event" value={e} defaultChecked={e === "message.received"} /> <span className="font-mono text-[13px]">{e}</span></label>)}
            </fieldset>
            <div><SubmitButton pending="Adding…">Add webhook</SubmitButton></div>
          </SecretForm>
        </Card>
      )}
    </>
  );
}

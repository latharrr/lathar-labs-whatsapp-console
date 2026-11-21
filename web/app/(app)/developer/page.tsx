import { prisma } from "@ll/db";
import { API_SCOPES, can } from "@ll/db/src/permissions";
import { ConfirmForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { PageHeader, StatusChip, td, th } from "@/components/ui/kit";
import { ago } from "@/lib/format";
import { requirePage } from "@/lib/session";
import { createKey, revokeKey } from "./actions";
import { SecretForm } from "./secret";

export const metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

const SCOPE: Record<string, string> = { "messages:send": "Send messages", "contacts:write": "Create and update contacts", "events:write": "Send events (orders, leads)", read: "Read contacts and message status" };

export default async function KeysPage() {
  const m = await requirePage("analytics.read");
  const keys = await prisma.apiKey.findMany({ where: { orgId: m.orgId }, orderBy: { createdAt: "desc" } });
  const manage = can(m.role, "developer.manage");
  return (
    <>
      <PageHeader title="API keys" subtitle="For your own systems. A key acts only in this workspace and only within its scopes. Keys are stored hashed." />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-x-auto">
          <CardTitle>Keys</CardTitle>
          {keys.length === 0 ? <p className="text-sm text-muted">No keys yet.</p> : (
            <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Name</th><th className={th}>Key</th><th className={`${th} hidden sm:table-cell`}>Scopes</th><th className={`${th} hidden md:table-cell`}>Last used</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{keys.map((k) => <tr key={k.id}><td className={td}>{k.name}{k.revokedAt && <span className="ml-1"><StatusChip status="cancelled" /></span>}</td><td className={`${td} font-mono text-[13px]`}>{k.prefix}…</td><td className={`${td} hidden sm:table-cell`}>{k.scopes.join(", ")}</td><td className={`${td} hidden text-muted md:table-cell`}>{ago(k.lastUsedAt)}</td>
                <td className={`${td} text-right`}>{manage && !k.revokedAt && <ConfirmForm action={revokeKey} hidden={{ id: k.id }} variant="ghost" tone="danger" label="Revoke" title={`Revoke ${k.name}?`} body="Systems using it stop working immediately. This cannot be undone." confirm="Revoke" />}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card>
          <CardTitle>New key</CardTitle>
          {manage ? (
            <SecretForm action={createKey}>
              <Field label="Name" htmlFor="kn" hint="What uses it, e.g. Shopify app or n8n."><Input id="kn" name="name" required /></Field>
              <fieldset className="flex flex-col gap-1.5"><legend className="text-sm font-medium">Scopes</legend>
                {API_SCOPES.map((s) => <label key={s} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="scope" value={s} defaultChecked={s === "events:write"} /> {SCOPE[s]} <span className="font-mono text-xs text-muted">{s}</span></label>)}
              </fieldset>
              <div><SubmitButton pending="Creating…">Create key</SubmitButton></div>
            </SecretForm>
          ) : <p className="text-sm text-muted">Only Owners and Admins can create keys.</p>}
        </Card>
      </div>
    </>
  );
}

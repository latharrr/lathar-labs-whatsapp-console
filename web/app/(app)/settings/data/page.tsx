import { prisma } from "@ll/db";
import { aiStatus } from "@ll/db/src/ai";
import { can } from "@ll/db/src/permissions";
import { redis } from "@ll/db/src/queue";
import { storageStatus } from "@ll/db/src/storage";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";
import { saveRetention } from "../actions";

export const metadata = { title: "Data and integrations" };
export const dynamic = "force-dynamic";

export default async function DataPage() {
  const m = await requirePage("settings.manage");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: m.orgId } });
  const redisOk = await redis().ping().then(() => true, () => false);
  const storage = storageStatus();
  const ai = aiStatus();
  let rates = false;
  try { rates = Object.values(JSON.parse(process.env.PRICING_RATES || "{}")).some((v) => typeof v === "number" && v > 0); } catch {}
  const items: [string, boolean, string][] = [
    ["Meta app secret (webhook signatures)", !!process.env.META_APP_SECRET, process.env.META_APP_SECRET ? "Set" : "Not set: every webhook is rejected"],
    ["Meta app id (token checks, uploads)", !!process.env.META_APP_ID, process.env.META_APP_ID ? "Set" : "Not set: token expiry checks, template media samples and profile photos are unavailable"],
    ["Queue (Redis)", redisOk, redisOk ? "Reachable" : "Not reachable: sends wait until it is back"],
    ["Media storage", storage.ready, storage.detail],
    ["Pricing rates", rates, rates ? "Set (estimates shown)" : "Not set: cost shows counts only"],
    ["AI replies (Anthropic, paid)", ai.ready, ai.detail],
    ["Email (invites)", false, "No mail service configured: invites are links you send yourself"],
  ];
  return (
    <>
      <PageHeader title="Data and integrations" />
      <Card>
        <CardTitle>Integrations on this server</CardTitle>
        <ul className="flex flex-col gap-2 text-sm">{items.map(([k, ok, d]) => <li key={k} className="flex flex-wrap items-center gap-2 border-b border-line pb-2"><span className="min-w-[220px] flex-1 font-medium">{k}</span><Chip tone={ok ? "ok" : "neutral"}>{ok ? "Ready" : "Not configured"}</Chip><span className="w-full text-muted sm:w-auto">{d}</span></li>)}</ul>
        <p className="mt-3 text-xs text-muted">Credentials live in the server&apos;s environment, never in the database or the repository. Meta tokens are encrypted with ENCRYPTION_KEY.</p>
      </Card>
      <Card>
        <CardTitle>Data retention</CardTitle>
        <ActionForm action={saveRetention} className="grid gap-3 sm:grid-cols-2">
          <Field label="Delete messages older than (days)" htmlFor="rm" hint="Empty keeps everything. Stored media is deleted with its message."><Input id="rm" name="messages" type="number" min={30} max={3650} defaultValue={org.messageRetentionDays ?? ""} disabled={!can(m.role, "settings.manage")} /></Field>
          <Field label="Delete processed webhook events after (days)" htmlFor="re" hint="Events that failed to process are kept until they succeed."><Input id="re" name="events" type="number" min={7} max={365} defaultValue={org.eventRetentionDays} required /></Field>
          <div><SubmitButton pending="Saving…">Save retention</SubmitButton></div>
        </ActionForm>
        <p className="mt-3 text-xs text-muted">To erase one person&apos;s data (GDPR / DPDP request), open the contact and use Delete contact and data.</p>
      </Card>
    </>
  );
}

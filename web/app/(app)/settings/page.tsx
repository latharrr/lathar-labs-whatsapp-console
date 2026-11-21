import { prisma } from "@ll/db";
import { requireMember, canManage } from "@/lib/session";
import { ago, limit, quality } from "@/lib/format";
import { Card, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ConnectForm, SyncForm } from "./forms";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const m = await requireMember();
  const manage = canManage(m.role);
  const wabas = await prisma.waba.findMany({ where: { orgId: m.orgId }, include: { phoneNumbers: { orderBy: { displayPhoneNumber: "asc" } } }, orderBy: { createdAt: "asc" } });
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-[380] leading-9 tracking-[-0.01em]">Settings</h1>
        <p className="mt-1 text-muted">Connected accounts and webhook setup.</p>
      </div>

      <Card aria-labelledby="acc-h">
        <CardTitle id="acc-h">WhatsApp Business Accounts</CardTitle>
        {wabas.length === 0 && <p className="text-muted">None connected yet.</p>}
        <ul className="flex flex-col gap-4">
          {wabas.map((w) => (
            <li key={w.id} className="rounded-control border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 font-semibold">{w.name ?? "Unnamed account"} <span className="tnum font-normal text-muted">· {w.metaWabaId}</span></span>
                {w.isFixture ? (
                  <Chip tone="warn">Test account, not connected to Meta</Chip>
                ) : (
                  <Chip tone={w.tokenValid === false ? "err" : w.tokenExpiresAt ? "warn" : w.tokenValid ? "ok" : "neutral"}>
                    {w.tokenValid === false ? "Token invalid: reconnect" : w.tokenExpiresAt ? `Token expires ${w.tokenExpiresAt.toLocaleDateString("en-IN")}` : w.tokenValid ? "Token valid" : "Token not checked"}
                  </Chip>
                )}
                {manage && <SyncForm id={w.id} disabled={w.isFixture} />}
              </div>
              {/* no sideways scroll on phones: the display name sits under the number and Synced is hidden */}
              <table className="mt-3 w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[13px] text-muted">
                    <th scope="col" className="border-b border-line py-2 pr-3 font-medium">Number</th>
                    <th scope="col" className="border-b border-line py-2 pr-3 font-medium">Quality</th>
                    <th scope="col" className="border-b border-line py-2 pr-3 font-medium">Messaging limit</th>
                    <th scope="col" className="hidden border-b border-line py-2 text-right font-medium sm:table-cell">Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {w.phoneNumbers.map((p) => {
                    const q = quality(p.qualityRating);
                    return (
                      <tr key={p.id} className="border-b border-line last:border-b-0">
                        <td className="py-2.5 pr-3 align-top">
                          <span className="tnum whitespace-nowrap">{p.displayPhoneNumber}</span>
                          <span className="block text-xs text-muted">
                            {p.verifiedName ?? "No display name"}{p.nameStatus && p.nameStatus !== "APPROVED" && ` (name ${p.nameStatus.toLowerCase().replace(/_/g, " ")})`}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 align-top"><Chip tone={q.tone}>{q.label}</Chip></td>
                        <td className="tnum py-2.5 pr-3 align-top">{limit(p.messagingLimit)}</td>
                        <td className="hidden py-2.5 text-right align-top text-muted sm:table-cell">{p.isFixture ? "Test data" : ago(p.syncedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      </Card>

      {manage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card aria-labelledby="connect-h">
            <CardTitle id="connect-h">Connect an account</CardTitle>
            <p className="mb-4 text-sm text-muted">
              Read-only check: the dashboard only calls GET on Meta to confirm the token, account and numbers. It does not change your webhook, subscriptions or anything the live console uses.
            </p>
            <ConnectForm />
          </Card>
          <Card aria-labelledby="hook-h">
            <CardTitle id="hook-h">Webhook</CardTitle>
            <dl className="flex flex-col gap-3 text-sm">
              <div><dt className="text-xs text-muted">Callback URL (needs public HTTPS)</dt><dd className="mt-0.5 break-all font-mono text-[13px]">{base}/api/webhooks/meta</dd></div>
              <div>
                <dt className="text-xs text-muted">Verify token</dt>
                <dd className="mt-0.5">
                  {process.env.META_VERIFY_TOKEN ? (
                    <details><summary className="cursor-pointer text-sm">Show</summary><code className="break-all font-mono text-[13px]">{process.env.META_VERIFY_TOKEN}</code></details>
                  ) : <><Chip tone="err">Not set</Chip> <span className="text-xs text-muted">Add <code className="font-mono">META_VERIFY_TOKEN</code> to the server&apos;s .env</span></>}
                </dd>
              </div>
              <div><dt className="text-xs text-muted">Signature check</dt><dd className="mt-0.5">{process.env.META_APP_SECRET ? <Chip tone="ok">App secret set</Chip> : <><Chip tone="err">App secret missing: every event is rejected</Chip> <span className="text-xs text-muted"><code className="font-mono">META_APP_SECRET</code> in .env</span></>}</dd></div>
            </dl>
            <p className="mt-4 rounded-control bg-warn-bg px-3 py-2 text-sm text-warn">
              The Lathar Labs app&apos;s webhook currently points at the live console. Do not repoint it here until you pick a routing option in the README.
            </p>
          </Card>
        </div>
      )}

      <p className="text-sm text-muted">Team members and roles are under <a href="/settings/team" className="underline">Team</a>.</p>
    </div>
  );
}

import { prisma } from "@ll/db";
import { can } from "@ll/db/src/permissions";
import { ActionForm, ConfirmForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { PageHeader, Select } from "@/components/ui/kit";
import { ago } from "@/lib/format";
import { requireMember } from "@/lib/session";
import { changeRole, inviteMember, removeMember, revokeInvite } from "../actions";
import { SecretForm } from "../../developer/secret";

export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

const ROLE_HELP = [
  ["Owner", "Everything, including other Owners."],
  ["Admin", "Everything except changing Owners: accounts, templates, campaigns, automations, developer tools, settings, exports."],
  ["Agent", "Inbox: reply, assign, notes, tags. Edit contacts and their consent."],
  ["Viewer", "Read only. Cannot send, edit or export."],
];

export default async function TeamPage() {
  const m = await requireMember();
  const manage = can(m.role, "team.manage");
  const [members, invites] = await Promise.all([
    prisma.membership.findMany({ where: { orgId: m.orgId }, include: { user: { select: { email: true, name: true } } }, orderBy: [{ role: "asc" }] }),
    manage ? prisma.invite.findMany({ where: { orgId: m.orgId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }) : [],
  ]);
  return (
    <>
      <PageHeader title="Team" subtitle={<>You are <strong>{m.email}</strong>, {m.role.toLowerCase()} of {m.orgName}.</>} />
      <Card>
        <CardTitle>Members</CardTitle>
        <ul className="text-sm">{members.map((x) => {
            const locked = !manage || x.userId === m.userId || (x.role === "OWNER" && m.role !== "OWNER");
            return (
              <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2.5">
                <div className="min-w-0 flex-1 basis-56 [overflow-wrap:anywhere]">{x.user.name ?? x.user.email}<span className="block text-xs text-muted">{x.user.email}{x.userId === m.userId ? " · you" : ""}</span></div>
                <div>{locked ? x.role.toLowerCase() : (
                  <ActionForm action={changeRole} className="flex gap-2">
                    <input type="hidden" name="id" value={x.id} />
                    <label htmlFor={`r${x.id}`} className="sr-only">Role for {x.user.email}</label>
                    <Select id={`r${x.id}`} name="role" defaultValue={x.role} className="h-8 w-auto">{["OWNER", "ADMIN", "AGENT", "VIEWER"].filter((r) => r !== "OWNER" || m.role === "OWNER").map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}</Select>
                    <SubmitButton variant="secondary" pending="…">Save</SubmitButton>
                  </ActionForm>
                )}</div>
                <div className="ml-auto">{!locked && <ConfirmForm action={removeMember} hidden={{ id: x.id }} variant="ghost" tone="danger" label="Remove" title={`Remove ${x.user.email}?`} body="They lose access to this workspace now. Their conversations become unassigned. Their account stays, in case they belong to another workspace." confirm="Remove" />}</div>
              </li>
            );
          })}</ul>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {manage && (
          <Card>
            <CardTitle>Invite someone</CardTitle>
            <SecretForm action={inviteMember}>
              <Field label="Email" htmlFor="ie"><Input id="ie" name="email" type="email" required /></Field>
              <Field label="Role" htmlFor="ir"><Select id="ir" name="role" defaultValue="AGENT">{["ADMIN", "AGENT", "VIEWER", ...(m.role === "OWNER" ? ["OWNER"] : [])].map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}</Select></Field>
              <p className="text-xs text-muted">No email service is configured, so you get a one-time link to send them yourself.</p>
              <div><SubmitButton pending="Creating…">Create invite link</SubmitButton></div>
            </SecretForm>
            {invites.length > 0 && (
              <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-sm">{invites.map((i) => <li key={i.id} className="flex items-center justify-between gap-2"><span className="min-w-0 break-all">{i.email} · {i.role.toLowerCase()} · <span className="text-muted">created {ago(i.createdAt)}</span></span><ConfirmForm action={revokeInvite} hidden={{ id: i.id }} variant="ghost" tone="danger" label="Revoke" title="Revoke this invite?" body="The link stops working." confirm="Revoke" /></li>)}</ul>
            )}
          </Card>
        )}
        <Card>
          <CardTitle>What each role can do</CardTitle>
          <dl className="flex flex-col gap-2 text-sm">{ROLE_HELP.map(([r, d]) => <div key={r}><dt className="font-medium">{r}</dt><dd className="text-muted">{d}</dd></div>)}</dl>
        </Card>
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@ll/db";
import { can } from "@ll/db/src/permissions";
import { ActionForm, ConfirmForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { PageHeader, StatusChip, td, th } from "@/components/ui/kit";
import { audit } from "@/lib/audit";
import { ago } from "@/lib/format";
import { requirePage } from "@/lib/session";
import { addTag, removeTag } from "../../inbox/actions";
import { eraseContact, recordOptIn, recordOptOut, setAttribute, toggleBlock, updateContact } from "../actions";

export const metadata = { title: "Contact" };
export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: { id: string } }) {
  const m = await requirePage("contacts.read");
  const c = await prisma.contact.findFirst({
    where: { id: params.id, orgId: m.orgId },
    include: {
      attributes: { orderBy: { key: "asc" } }, tags: { include: { tag: true } },
      conversations: { include: { phoneNumber: { select: { displayPhoneNumber: true } } } },
      recipients: { include: { campaign: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" }, take: 20 },
    },
  });
  if (!c) notFound();
  await audit(m, "pii.view", c.id); // personal data access is logged
  const [fields, events, consentLog] = await Promise.all([
    prisma.customField.findMany({ where: { orgId: m.orgId }, orderBy: { label: "asc" } }),
    prisma.apiEvent.findMany({ where: { orgId: m.orgId, contactId: c.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.auditLog.findMany({ where: { orgId: m.orgId, target: c.id, action: { in: ["contact.opt_in", "contact.opt_out", "contact.block", "contact.unblock"] } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const edit = can(m.role, "contacts.write");
  const name = c.name ?? c.profileName ?? `+${c.waId}`;
  return (
    <>
      <PageHeader title={name} subtitle={<span className="tnum">+{c.waId}{c.isFixture ? " · test contact" : ""}</span>}
        actions={c.conversations.map((v) => <Link key={v.id} href={`/inbox/${v.id}`} className="inline-flex h-9 items-center rounded-full border border-line bg-raised px-3.5 text-sm hover:bg-surface">Open chat via {v.phoneNumber.displayPhoneNumber}</Link>)} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Profile</CardTitle>
          <ActionForm action={updateContact} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={c.id} />
            <Field label="Name" htmlFor="name" hint={c.profileName ? `WhatsApp profile name: ${c.profileName}` : undefined}><Input id="name" name="name" defaultValue={c.name ?? ""} disabled={!edit} /></Field>
            <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" defaultValue={c.email ?? ""} disabled={!edit} /></Field>
            {edit && <div><SubmitButton variant="secondary" pending="Saving…">Save profile</SubmitButton></div>}
          </ActionForm>
        </Card>
        <Card>
          <CardTitle aside={<StatusChip status={c.optInStatus} />}>Marketing consent</CardTitle>
          <dl className="grid gap-2 text-sm">
            {c.optInStatus === "opted_in" && <><div><dt className="text-xs text-muted">Source</dt><dd>{c.optInSource}</dd></div><div><dt className="text-xs text-muted">Recorded</dt><dd>{c.optInAt?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</dd></div><div><dt className="text-xs text-muted">Proof</dt><dd className="break-all">{c.optInProof}</dd></div></>}
            {c.optInStatus === "opted_out" && <div><dt className="text-xs text-muted">Opted out</dt><dd>{c.optOutAt?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {c.optOutSource}</dd></div>}
            {c.optInStatus === "unknown" && <p className="text-muted">No marketing consent recorded. Campaigns skip this contact; service replies and utility templates still work.</p>}
          </dl>
          {edit && (
            <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
              <ActionForm action={recordOptIn} className="grid gap-2">
                <input type="hidden" name="id" value={c.id} />
                <Field label="Consent source" htmlFor="src" hint="Where they agreed, e.g. checkout form, in-store sign-up, WhatsApp START."><Input id="src" name="source" required /></Field>
                <Field label="Proof" htmlFor="proof" hint="A link, form submission id, message id or document reference."><Input id="proof" name="proof" required /></Field>
                <div><SubmitButton variant="secondary" pending="Saving…">Record opt-in</SubmitButton></div>
              </ActionForm>
              {c.optInStatus !== "opted_out" && <ConfirmForm action={recordOptOut} hidden={{ id: c.id }} label="Record opt-out" title="Opt this contact out of marketing?" body="Queued marketing and automated messages to them are cancelled now. They can opt back in by sending START." confirm="Opt out" />}
            </div>
          )}
          {consentLog.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1 border-t border-line pt-3 text-xs text-muted">{consentLog.map((l) => <li key={l.id}>{l.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {l.action.replace("contact.", "").replace("_", " ")} · {JSON.stringify(l.meta)}</li>)}</ul>
          )}
        </Card>
        <Card>
          <CardTitle>Attributes</CardTitle>
          {c.attributes.length === 0 ? <p className="text-sm text-muted">No attributes yet.</p> : (
            <dl className="grid gap-2 text-sm">{c.attributes.map((a) => <div key={a.key} className="flex justify-between gap-3 border-b border-line pb-1.5"><dt className="text-muted">{fields.find((f) => f.key === a.key)?.label ?? a.key}</dt><dd className="break-all text-right">{a.value}</dd></div>)}</dl>
          )}
          {edit && (
            <ActionForm action={setAttribute} resetOnOk className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input type="hidden" name="id" value={c.id} />
              <label htmlFor="ak" className="sr-only">Attribute</label>
              <Input id="ak" name="key" placeholder="Attribute, e.g. city" list="fieldlist" className="h-9" required />
              <datalist id="fieldlist">{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</datalist>
              <label htmlFor="av" className="sr-only">Value</label>
              <Input id="av" name="value" placeholder="Value (empty removes it)" className="h-9" />
              <SubmitButton variant="secondary" pending="…">Set</SubmitButton>
            </ActionForm>
          )}
        </Card>
        <Card>
          <CardTitle>Tags</CardTitle>
          <ul className="flex flex-wrap gap-1.5">
            {c.tags.length === 0 && <li className="text-sm text-muted">No tags.</li>}
            {c.tags.map((t) => <li key={t.tagId} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold">{t.tag.name}{edit && <ActionForm action={removeTag}><input type="hidden" name="contactId" value={c.id} /><input type="hidden" name="tagId" value={t.tagId} /><button aria-label={`Remove ${t.tag.name}`} className="text-muted hover:text-err">×</button></ActionForm>}</li>)}
          </ul>
          {edit && <ActionForm action={addTag} resetOnOk className="mt-3 flex gap-2"><input type="hidden" name="contactId" value={c.id} /><label htmlFor="tg" className="sr-only">Tag</label><Input id="tg" name="tag" placeholder="Add a tag" className="h-9" /><SubmitButton variant="secondary" pending="…">Add</SubmitButton></ActionForm>}
        </Card>
        <Card className="lg:col-span-2 overflow-x-auto">
          <CardTitle>Campaign history</CardTitle>
          {c.recipients.length === 0 ? <p className="text-sm text-muted">No campaign messages.</p> : (
            <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Campaign</th><th className={th}>Status</th><th className={`${th} hidden sm:table-cell`}>Replied</th><th className={`${th} hidden sm:table-cell`}>Clicked</th><th className={`${th} hidden sm:table-cell`}>Converted</th></tr></thead>
              <tbody>{c.recipients.map((r) => <tr key={r.id}><td className={td}><Link href={`/campaigns/${r.campaign.id}`} className="underline">{r.campaign.name}</Link>{r.skipReason && <span className="block text-xs text-muted">{r.skipReason}</span>}</td><td className={td}><StatusChip status={r.status} /></td><td className={`${td} hidden sm:table-cell`}>{r.repliedAt ? ago(r.repliedAt) : "No"}</td><td className={`${td} hidden sm:table-cell`}>{r.clickedAt ? ago(r.clickedAt) : "No"}</td><td className={`${td} hidden sm:table-cell`}>{r.convertedAt ? ago(r.convertedAt) : "No"}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle>Orders, leads and other events</CardTitle>
          {events.length === 0 ? <p className="text-sm text-muted">None yet. Your systems can send them with POST /api/v1/events.</p> : (
            <ul className="flex flex-col gap-2 text-sm">{events.map((e) => <li key={e.id} className="border-b border-line pb-2"><span className="font-medium">{e.name}</span> · <span className="text-xs text-muted">{e.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span><pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-muted">{JSON.stringify(e.data, null, 1)}</pre></li>)}</ul>
          )}
        </Card>
        {edit && (
          <Card className="lg:col-span-2">
            <CardTitle>Block or delete</CardTitle>
            <div className="flex flex-wrap gap-2">
              <ConfirmForm action={toggleBlock} hidden={{ id: c.id }} label={c.blocked ? "Unblock" : "Block"} title={c.blocked ? "Unblock this contact?" : "Block this contact?"} body={c.blocked ? "Messages can be sent to them again, subject to the usual rules." : "Nothing will be sent to them, and queued messages are cancelled. Their messages to you still arrive."} confirm={c.blocked ? "Unblock" : "Block"} />
              {can(m.role, "contacts.delete") && <ConfirmForm action={eraseContact} hidden={{ id: c.id }} variant="danger" tone="danger" label="Delete contact and data" title="Delete this contact permanently?" body="This deletes the contact, every message to and from them, stored files, queued sends and campaign records. It cannot be undone. Use this for erasure requests (GDPR / DPDP)." confirm="Delete permanently" />}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

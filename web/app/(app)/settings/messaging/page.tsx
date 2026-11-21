import { prisma } from "@ll/db";
import { can } from "@ll/db/src/permissions";
import { ActionForm, ConfirmForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { PageHeader, Textarea, td, th } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";
import { deleteQuickReply, saveMessaging, saveQuickReply } from "../actions";

export const metadata = { title: "Messaging settings" };
export const dynamic = "force-dynamic";
const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]] as const;

export default async function MessagingSettingsPage() {
  const m = await requirePage("inbox.read");
  const [org, quick] = await Promise.all([prisma.organization.findUniqueOrThrow({ where: { id: m.orgId } }), prisma.quickReply.findMany({ where: { orgId: m.orgId }, orderBy: { shortcut: "asc" } })]);
  const hours = (org.businessHours ?? {}) as Record<string, [string, string][]>;
  const edit = can(m.role, "settings.manage");
  return (
    <>
      <PageHeader title="Hours, opt-out and quick replies" />
      <Card>
        <ActionForm action={saveMessaging} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2" disabled={!edit}>
            <legend className="text-sm font-semibold">Business hours</legend>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="hoursOn" defaultChecked={!!org.businessHours} /> Use business hours (away messages fire outside them)</label>
            <Field label="Timezone" htmlFor="tz"><Input id="tz" name="timezone" defaultValue={org.timezone} className="max-w-xs" /></Field>
            <div className="grid gap-2 sm:grid-cols-2">{DAYS.map(([d, label]) => (
              <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="inline-flex w-28 items-center gap-2"><input type="checkbox" name={`${d}:open`} defaultChecked={!!hours[d]?.length || (!org.businessHours && !["sat", "sun"].includes(d))} /> {label}</label>
                <label className="sr-only" htmlFor={`${d}f`}>{label} opens</label><Input id={`${d}f`} type="time" name={`${d}:from`} defaultValue={hours[d]?.[0]?.[0] ?? "09:00"} className="h-9 w-32" />
                <span className="text-muted">to</span>
                <label className="sr-only" htmlFor={`${d}t`}>{label} closes</label><Input id={`${d}t`} type="time" name={`${d}:to`} defaultValue={hours[d]?.[0]?.[1] ?? "18:00"} className="h-9 w-32" />
              </div>
            ))}</div>
          </fieldset>
          <fieldset className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2" disabled={!edit}>
            <legend className="text-sm font-semibold">Opt-out and opt-in words</legend>
            <Field label="Opt-out words" htmlFor="oo" hint="Comma separated, whole message, any case. Applied before automations; queued marketing is cancelled at once."><Input id="oo" name="optOut" defaultValue={org.optOutKeywords.join(", ")} /></Field>
            <Field label="Opt-in words" htmlFor="oi" hint="A customer sending one records a marketing opt-in, with the message as proof."><Input id="oi" name="optIn" defaultValue={org.optInKeywords.join(", ")} /></Field>
            <div className="sm:col-span-2"><Field label="Reply after an opt-out (optional)" htmlFor="or" hint="Sent once, inside the window the customer just opened. Leave empty to say nothing."><Textarea id="or" name="optOutReply" defaultValue={org.optOutReply ?? ""} rows={2} /></Field></div>
          </fieldset>
          {edit && <div><SubmitButton pending="Saving…">Save</SubmitButton></div>}
        </ActionForm>
      </Card>
      <Card className="overflow-x-auto">
        <CardTitle>Quick replies (canned responses)</CardTitle>
        <p className="mb-3 text-sm text-muted">Agents type / and the shortcut in the inbox. {"{{name}}"} becomes the contact&apos;s name.</p>
        {quick.length > 0 && (
          <table className="mb-4 w-full border-collapse text-sm"><thead><tr><th className={th}>Shortcut</th><th className={th}>Text</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{quick.map((q) => <tr key={q.id}><td className={`${td} font-mono text-[13px]`}>/{q.shortcut}<span className="block font-sans text-xs text-muted">{q.title}</span></td><td className={`${td} whitespace-pre-wrap`}>{q.body}</td><td className={`${td} text-right`}>{edit && <ConfirmForm action={deleteQuickReply} hidden={{ id: q.id }} variant="ghost" tone="danger" label="Delete" title={`Delete /${q.shortcut}?`} body="Agents can no longer insert it." confirm="Delete" />}</td></tr>)}</tbody></table>
        )}
        {edit && (
          <ActionForm action={saveQuickReply} resetOnOk className="grid gap-2 sm:grid-cols-[160px_1fr]">
            <Field label="Shortcut" htmlFor="qs"><Input id="qs" name="shortcut" required placeholder="thanks" className="font-mono" /></Field>
            <Field label="Title" htmlFor="qt"><Input id="qt" name="title" placeholder="Thank you" /></Field>
            <div className="sm:col-span-2"><Field label="Text" htmlFor="qb"><Textarea id="qb" name="body" required rows={2} /></Field></div>
            <div><SubmitButton variant="secondary" pending="Saving…">Save quick reply</SubmitButton></div>
          </ActionForm>
        )}
      </Card>
    </>
  );
}

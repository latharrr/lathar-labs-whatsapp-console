import { prisma } from "@ll/db";
import { can } from "@ll/db/src/permissions";
import { ActionForm, ConfirmForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { PageHeader, Select, td, th } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";
import { deleteField, saveField } from "../actions";

export const metadata = { title: "Custom fields" };
export const dynamic = "force-dynamic";

export default async function FieldsPage() {
  const m = await requirePage("contacts.read");
  const fields = await prisma.customField.findMany({ where: { orgId: m.orgId }, orderBy: { label: "asc" } });
  const used = await prisma.contactAttribute.groupBy({ by: ["key"], where: { contact: { orgId: m.orgId } }, _count: { _all: true } });
  return (
    <>
      <PageHeader title="Custom fields" subtitle="Named attributes your team fills in, imports, segments on, and uses as template variables." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <CardTitle>Fields</CardTitle>
          {fields.length === 0 ? <p className="text-sm text-muted">No custom fields yet. Attributes still work without one; a field gives them a label and type.</p> : (
            <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Label</th><th className={th}>Key</th><th className={th}>Type</th><th className={`${th} text-right`}>Contacts</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{fields.map((f) => <tr key={f.id}><td className={td}>{f.label}</td><td className={`${td} font-mono text-[13px]`}>{f.key}</td><td className={td}>{f.type}</td><td className={`${td} tnum text-right`}>{used.find((u) => u.key === f.key)?._count._all ?? 0}</td>
                <td className={`${td} text-right`}>{can(m.role, "settings.manage") && <ConfirmForm action={deleteField} hidden={{ id: f.id }} variant="ghost" tone="danger" label="Delete" title={`Delete field ${f.label}?`} body="Values already saved on contacts are kept as plain attributes." confirm="Delete" />}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card>
          <CardTitle>Add or update a field</CardTitle>
          {can(m.role, "settings.manage") ? (
            <ActionForm action={saveField} resetOnOk className="flex flex-col gap-3">
              <Field label="Label" htmlFor="fl"><Input id="fl" name="label" required placeholder="City" /></Field>
              <Field label="Key" htmlFor="fk" hint="Lowercase, used in imports, segments (attr) and template variables (attr:key)."><Input id="fk" name="key" required placeholder="city" className="font-mono" /></Field>
              <Field label="Type" htmlFor="ft"><Select id="ft" name="type"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="boolean">Yes / no</option></Select></Field>
              <div><SubmitButton pending="Saving…">Save field</SubmitButton></div>
            </ActionForm>
          ) : <p className="text-sm text-muted">Only Owners and Admins can manage fields.</p>}
        </Card>
      </div>
    </>
  );
}

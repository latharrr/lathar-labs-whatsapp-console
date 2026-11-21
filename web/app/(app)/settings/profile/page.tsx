import { decrypt, prisma } from "@ll/db";
import { graphGet } from "@ll/db/src/graph";
import { can } from "@ll/db/src/permissions";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/field";
import { Empty, PageHeader, Select, Textarea } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";
import { saveProfile } from "../actions";

export const metadata = { title: "Business profile" };
export const dynamic = "force-dynamic";

type Profile = { about?: string; address?: string; description?: string; email?: string; profile_picture_url?: string; websites?: string[]; vertical?: string };
const VERTICALS = ["", "OTHER", "AUTO", "BEAUTY", "APPAREL", "EDU", "ENTERTAIN", "EVENT_PLAN", "FINANCE", "GROCERY", "GOVT", "HOTEL", "HEALTH", "NONPROFIT", "PROF_SERVICES", "RETAIL", "TRAVEL", "RESTAURANT"];

export default async function ProfilePage() {
  const m = await requirePage("settings.manage");
  const phones = await prisma.phoneNumber.findMany({ where: { waba: { orgId: m.orgId } }, include: { waba: true }, orderBy: { displayPhoneNumber: "asc" } });
  if (!phones.length) return <Empty title="No numbers" body="Connect a WhatsApp Business Account first." />;
  const profiles = await Promise.all(phones.map(async (p) => {
    if (p.isFixture || p.waba.isFixture) return { test: true as const };
    try {
      const r = await graphGet<{ data: Profile[] }>(`${p.metaPhoneNumberId}/whatsapp_business_profile`, decrypt(p.waba.accessTokenEnc), { fields: "about,address,description,email,profile_picture_url,websites,vertical" });
      return { profile: r.data[0] ?? {} };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Could not reach Meta" };
    }
  }));
  const edit = can(m.role, "settings.manage");
  return (
    <>
      <PageHeader title="Business profile" subtitle="What customers see when they open your business's info in WhatsApp. Read from and saved to Meta." />
      {phones.map((p, i) => {
        const r = profiles[i];
        const pr: Profile = "profile" in r ? r.profile! : {};
        const disabled = !edit || !("profile" in r);
        return (
          <Card key={p.id}>
            <CardTitle aside={"test" in r ? <Chip tone="warn">Test account, not connected to Meta</Chip> : "error" in r ? <Chip tone="err">Could not load from Meta</Chip> : undefined}>{p.displayPhoneNumber} · {p.verifiedName ?? "Unnamed"}</CardTitle>
            {"error" in r && <p className="mb-3 rounded-control bg-err-bg px-3 py-2 text-sm text-err">{r.error}</p>}
            {"test" in r && <p className="mb-3 text-sm text-muted">Test accounts have no profile at Meta. The form below shows the fields you can edit once a real number is connected.</p>}
            <ActionForm action={saveProfile} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="phoneId" value={p.id} />
              {pr.profile_picture_url && <img src={pr.profile_picture_url} alt="Current profile photo" className="size-20 rounded-full border border-line sm:col-span-2" />}
              <Field label="About" htmlFor={`a${i}`} hint="Up to 139 characters."><Input id={`a${i}`} name="about" defaultValue={pr.about} maxLength={139} disabled={disabled} /></Field>
              <Field label="Category" htmlFor={`v${i}`}><Select id={`v${i}`} name="vertical" defaultValue={pr.vertical ?? ""} disabled={disabled}>{VERTICALS.map((v) => <option key={v} value={v}>{v ? v.toLowerCase().replace(/_/g, " ") : "Not set"}</option>)}</Select></Field>
              <div className="sm:col-span-2"><Field label="Description" htmlFor={`d${i}`} hint="Up to 512 characters."><Textarea id={`d${i}`} name="description" defaultValue={pr.description} maxLength={512} disabled={disabled} /></Field></div>
              <Field label="Address" htmlFor={`ad${i}`}><Input id={`ad${i}`} name="address" defaultValue={pr.address} maxLength={256} disabled={disabled} /></Field>
              <Field label="Email" htmlFor={`e${i}`}><Input id={`e${i}`} name="email" type="email" defaultValue={pr.email} maxLength={128} disabled={disabled} /></Field>
              <Field label="Websites" htmlFor={`w${i}`} hint="Up to two, separated by a space."><Input id={`w${i}`} name="websites" defaultValue={pr.websites?.join(" ")} disabled={disabled} /></Field>
              <Field label="New profile photo" htmlFor={`ph${i}`} hint="JPEG or PNG, square, up to 5 MB. Uploaded with Meta's Resumable Upload API (needs META_APP_ID)."><input id={`ph${i}`} name="photo" type="file" accept="image/jpeg,image/png" disabled={disabled} className="text-sm" /></Field>
              {!disabled && <div className="sm:col-span-2"><SubmitButton pending="Saving to Meta…">Save profile</SubmitButton></div>}
            </ActionForm>
          </Card>
        );
      })}
    </>
  );
}

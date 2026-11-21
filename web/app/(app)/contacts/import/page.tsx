import { can } from "@ll/db/src/permissions";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";
import { ImportForm } from "./client";

export const metadata = { title: "Import contacts" };

export default async function ImportPage() {
  const m = await requirePage("contacts.read");
  return (
    <>
      <PageHeader title="Import contacts" subtitle="Numbers are checked for E.164 format and de-duplicated. Existing contacts are updated, not duplicated." />
      <Card>{can(m.role, "contacts.import") ? <ImportForm /> : <p className="text-sm text-muted">Only Owners and Admins can import contacts.</p>}</Card>
    </>
  );
}

import { SubNav } from "@/components/sub-nav";

export default function ContactsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <SubNav label="Contacts sections" items={[{ href: "/contacts", label: "Contacts" }, { href: "/contacts/import", label: "Import CSV" }, { href: "/contacts/segments", label: "Segments" }, { href: "/contacts/fields", label: "Custom fields" }]} />
      {children}
    </div>
  );
}

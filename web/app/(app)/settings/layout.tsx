import { SubNav } from "@/components/sub-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <SubNav label="Settings sections" items={[
        { href: "/settings", label: "Accounts and webhook" }, { href: "/settings/profile", label: "Business profile" }, { href: "/settings/team", label: "Team" },
        { href: "/settings/messaging", label: "Hours, opt-out and quick replies" }, { href: "/settings/data", label: "Data and integrations" }, { href: "/settings/audit", label: "Audit log" },
      ]} />
      {children}
    </div>
  );
}

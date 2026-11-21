import { SubNav } from "@/components/sub-nav";

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <SubNav label="Developer sections" items={[{ href: "/developer", label: "API keys" }, { href: "/developer/webhooks", label: "Outbound webhooks" }, { href: "/developer/events", label: "Event log" }, { href: "/developer/errors", label: "Error codes" }, { href: "/developer/api", label: "API reference" }]} />
      {children}
    </div>
  );
}

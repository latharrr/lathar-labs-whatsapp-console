import { requireMember } from "@/lib/session";
import { switchWorkspace } from "@/lib/workspace-actions";
import { MobileNav, Sidebar, Wordmark } from "@/components/nav";
import { Shortcuts } from "@/components/shortcuts";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOut } from "@/components/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const m = await requireMember();
  const footer = (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">Workspace</span>
      {m.orgs.length > 1 ? (
        <form action={switchWorkspace} className="flex gap-1">
          <label htmlFor="ws" className="sr-only">Switch workspace</label>
          <select id="ws" name="orgId" defaultValue={m.orgId} className="h-8 min-w-0 flex-1 rounded-control border border-line bg-raised px-2 text-sm">
            {m.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="h-8 rounded-control border border-line px-2 text-xs hover:bg-raised">Switch</button>
        </form>
      ) : <span className="font-medium">{m.orgName}</span>}
      <span className="truncate text-xs text-muted">{m.email} · {m.role.toLowerCase()}</span>
      <SignOut />
      <span className="mt-1 hidden text-xs text-muted md:block">Press <kbd className="font-mono">?</kbd> for shortcuts</span>
    </div>
  );
  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-raised focus:px-3 focus:py-2">Skip to content</a>
      <Sidebar footer={footer} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-line px-4 md:px-6">
          <MobileNav footer={footer} />
          <span className="md:hidden"><Wordmark /></span>
          <span className="flex-1" />
          <ThemeToggle />
          <span aria-label={`Signed in as ${m.email}`} className="inline-flex size-8 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold uppercase text-accent">
            {m.email.slice(0, 2)}
          </span>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-8 md:px-6">{children}</main>
      </div>
      <Shortcuts />
    </div>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon, type IconName } from "./icons";
import { cn } from "@/lib/cn";

const ITEMS: { label: string; icon: IconName; href: string; key: string }[] = [
  { label: "Overview", icon: "overview", href: "/", key: "o" },
  { label: "Inbox", icon: "inbox", href: "/inbox", key: "i" },
  { label: "Contacts", icon: "contacts", href: "/contacts", key: "c" },
  { label: "Templates", icon: "templates", href: "/templates", key: "t" },
  { label: "Campaigns", icon: "campaigns", href: "/campaigns", key: "m" },
  { label: "Automations", icon: "automations", href: "/automations", key: "a" },
  { label: "Analytics", icon: "analytics", href: "/analytics", key: "y" },
  { label: "Developer", icon: "developer", href: "/developer", key: "d" },
  { label: "Settings", icon: "settings", href: "/settings", key: "s" },
];

export function Wordmark() {
  return <span className="text-base font-semibold tracking-[-0.01em]">Lathar <span className="text-muted">Labs</span></span>;
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {ITEMS.map((it) => {
        const active = it.href && (it.href === "/" ? path === "/" : path.startsWith(it.href));
        const cls = "flex h-9 items-center gap-2.5 rounded-control px-2.5 text-sm";
        return (
          <Link key={it.label} href={it.href} onClick={onNavigate} aria-current={active ? "page" : undefined} aria-keyshortcuts={`g ${it.key}`}
            className={cn(cls, active ? "bg-raised font-semibold shadow-[inset_0_0_0_1px_var(--border)]" : "hover:bg-raised")}>
            <Icon name={it.icon} /><span className="flex-1">{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ footer }: { footer: React.ReactNode }) {
  return (
    <aside className="hidden w-[232px] shrink-0 flex-col gap-4 border-r border-line bg-surface px-3 py-4 md:flex">
      <div className="px-2 py-1"><Wordmark /></div>
      <NavList />
      <div className="mt-auto border-t border-line px-2 pt-3">{footer}</div>
    </aside>
  );
}

/** Below md the sidebar becomes a drawer (bar.md #7). framer-motion owns its presence only. */
export function MobileNav({ footer }: { footer: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="md:hidden">
      <button aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="inline-flex size-11 items-center justify-center rounded-control hover:bg-surface">
        <Icon name="menu" size={18} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.div key="scrim" className="fixed inset-0 z-40 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={() => setOpen(false)} />
            <motion.aside key="drawer" role="dialog" aria-modal="true" aria-label="Menu"
              className="fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col gap-4 bg-surface px-3 py-4 shadow-float"
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
              <div className="flex items-center justify-between px-2">
                <Wordmark />
                <button aria-label="Close menu" onClick={() => setOpen(false)} className="inline-flex size-11 items-center justify-center rounded-control hover:bg-raised"><Icon name="close" /></button>
              </div>
              <NavList onNavigate={() => setOpen(false)} />
              <div className="mt-auto border-t border-line px-2 pt-3">{footer}</div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function SubNav({ items, label }: { items: { href: string; label: string }[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="-mx-1 flex flex-wrap gap-1 px-1 pb-1">
      {items.map((i) => {
        const active = i.href === path || (i.href !== items[0].href && path.startsWith(i.href));
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm", active ? "bg-surface font-semibold shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted hover:text-fg")}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

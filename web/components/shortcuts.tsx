"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export const NAV_KEYS: Record<string, string> = { o: "/", i: "/inbox", c: "/contacts", t: "/templates", m: "/campaigns", a: "/automations", y: "/analytics", d: "/developer", s: "/settings" };

const HELP: [string, string][] = [
  ["g then o / i / c / t / m / a / y / d / s", "Go to Overview, Inbox, Contacts, Templates, Campaigns, Automations, Analytics, Developer, Settings"],
  ["/", "Search on this page"],
  ["j / k", "Inbox: next / previous conversation"],
  ["r", "Inbox: write a reply"],
  ["e", "Inbox: close or reopen the conversation"],
  ["?", "Show these shortcuts"],
];

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Global shortcuts. Ignored while typing, and never bound to a single letter that sends or deletes. */
export function Shortcuts() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "?") { e.preventDefault(); dialog.current?.showModal(); return; }
      if (e.key === "/") {
        const el = document.querySelector<HTMLElement>("[data-search]");
        if (el) { e.preventDefault(); el.focus(); }
        return;
      }
      if (e.key === "g") { g = Date.now(); return; }
      if (Date.now() - g < 1200 && NAV_KEYS[e.key]) { e.preventDefault(); g = 0; router.push(NAV_KEYS[e.key]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return (
    <dialog ref={dialog} aria-label="Keyboard shortcuts" className="w-[min(560px,calc(100vw-32px))] rounded-card border border-line bg-raised p-0 text-fg shadow-float backdrop:bg-black/40">
      <div className="p-5">
        <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          {HELP.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
              <dt className="shrink-0 font-mono text-[13px] sm:w-56">{k}</dt><dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
        <form method="dialog" className="mt-4 flex justify-end"><button className="h-9 rounded-full border border-line px-3.5 text-sm hover:bg-surface">Close</button></form>
      </div>
    </dialog>
  );
}

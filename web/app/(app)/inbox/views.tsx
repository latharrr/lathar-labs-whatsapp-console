import Link from "next/link";
import type { Message } from "@ll/db";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/field";
import { Select, StatusChip } from "@/components/ui/kit";
import { ago } from "@/lib/format";
import { VIEWS, type InboxFilters, type listConversations } from "@/lib/inbox";
import { cn } from "@/lib/cn";

const qs = (f: InboxFilters, over: Partial<InboxFilters>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...over })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export function ConversationList({ data, filters, activeId, className }: { data: Awaited<ReturnType<typeof listConversations>>; filters: InboxFilters; activeId?: string; className?: string }) {
  const view = filters.view ?? "open";
  return (
    <section aria-label="Conversations" className={cn("flex min-h-0 flex-col rounded-card border border-line bg-raised", className)}>
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <nav aria-label="Inbox views" className="-mx-1 flex flex-wrap gap-1 px-1">
          {VIEWS.map((v) => (
            <Link key={v.id} href={`/inbox${qs(filters, { view: v.id })}`} aria-current={view === v.id ? "true" : undefined}
              className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-sm", view === v.id ? "bg-surface font-semibold shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted hover:text-fg")}>{v.label}</Link>
          ))}
        </nav>
        <form className="grid grid-cols-2 gap-2" action="/inbox">
          <input type="hidden" name="view" value={view} />
          <label htmlFor="q" className="sr-only">Search conversations</label>
          <Input id="q" name="q" data-search defaultValue={filters.q} placeholder="Search name, number, text  ( / )" className="col-span-2 h-9" />
          <label htmlFor="tag" className="sr-only">Tag</label>
          <Select id="tag" name="tag" defaultValue={filters.tag ?? ""} className="h-9"><option value="">Any tag</option>{data.tags.map((t) => <option key={t.id}>{t.name}</option>)}</Select>
          <label htmlFor="number" className="sr-only">Number</label>
          <Select id="number" name="number" defaultValue={filters.number ?? ""} className="h-9"><option value="">All numbers</option>{data.numbers.map((n) => <option key={n.id} value={n.id}>{n.displayPhoneNumber}{n.isFixture ? " (test)" : ""}</option>)}</Select>
          <button className="col-span-2 h-8 rounded-full border border-line text-sm hover:bg-surface">Apply filters</button>
        </form>
      </div>
      {data.rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">{filters.q || filters.tag || filters.number ? "No conversations match these filters." : view === "mine" ? "Nothing is assigned to you." : "No conversations here yet. They appear when a customer writes to one of your numbers."}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {data.rows.map((c) => {
            const name = c.contact.name ?? c.contact.profileName ?? `+${c.contact.waId}`;
            return (
              <li key={c.id}>
                <Link href={`/inbox/${c.id}${qs(filters, {})}`} aria-current={c.id === activeId ? "page" : undefined}
                  className={cn("flex flex-col gap-0.5 border-b border-line px-3 py-2.5 hover:bg-surface", c.id === activeId && "bg-accent-subtle")}>
                  <span className="flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1 truncate", c.unread ? "font-semibold" : "font-medium")}>{name}</span>
                    <span className="tnum shrink-0 text-xs text-muted">{ago(c.lastMessageAt)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">{c.lastMessagePreview ?? "No messages yet"}</span>
                    {c.unread > 0 && <span className="tnum rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-on" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                  </span>
                  <span className="flex flex-wrap gap-1 text-xs text-muted">
                    {c.status === "closed" && <span>Closed ·</span>}
                    <span>{c.assignee ? `Assigned to ${c.assignee.name ?? c.assignee.email}` : "Unassigned"}</span>
                    {c.phoneNumber.isFixture && <span>· test</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MediaPart({ m }: { m: Message }) {
  if (m.mediaStatus === "stored") {
    const src = `/api/media/${m.id}`;
    if (m.mediaMime?.startsWith("image/")) return <img src={src} alt={m.body || "Image from the conversation"} className="mt-1 max-h-64 rounded-control" />;
    if (m.mediaMime?.startsWith("video/")) return <video src={src} controls className="mt-1 max-h-64 rounded-control" />;
    if (m.mediaMime?.startsWith("audio/")) return <audio src={src} controls className="mt-1 w-full" />;
    return <a href={src} className="mt-1 inline-block text-sm text-accent underline">Download {m.mediaName ?? "file"}</a>;
  }
  if (m.mediaStatus === "pending") return <span className="text-xs text-muted">Downloading the file from Meta…</span>;
  if (m.mediaStatus) return <span className="text-xs text-muted">File unavailable: {m.errorTitle ?? "download failed"}</span>;
  return null;
}

function Location({ p }: { p: Record<string, unknown> }) {
  const loc = p.location as { latitude?: number; longitude?: number; name?: string; address?: string } | undefined;
  if (!loc?.latitude) return null;
  return <a className="text-sm text-accent underline" href={`https://www.openstreetmap.org/?mlat=${loc.latitude}&mlon=${loc.longitude}#map=16/${loc.latitude}/${loc.longitude}`} target="_blank" rel="noreferrer">Open location on a map</a>;
}

export function Bubble({ m }: { m: Message }) {
  const out = m.direction === "OUT";
  const p = (m.payload ?? {}) as Record<string, unknown>;
  return (
    <li className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] rounded-card border px-3 py-2 sm:max-w-[70%]", out ? "border-accent-subtle bg-accent-subtle" : "border-line bg-raised")}>
        {m.type === "reaction" ? <span className="text-sm">Reacted {m.body}</span> : m.body && <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>}
        {m.type === "unknown" && out && <p className="text-sm italic text-muted">Sent outside this dashboard (we only saw its receipt)</p>}
        <MediaPart m={m} />
        {m.type === "location" && <Location p={p} />}
        <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5 text-xs text-muted">
          <time dateTime={m.timestamp.toISOString()} className="tnum">{m.timestamp.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
          {out && (m.isTest ? <Chip tone="warn">Test send, not delivered to WhatsApp</Chip> : <StatusChip status={m.status} />)}
          {m.errorCode && <span>error {m.errorCode}</span>}
        </div>
      </div>
    </li>
  );
}

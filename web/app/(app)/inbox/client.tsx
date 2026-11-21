"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/kit";
import { cn } from "@/lib/cn";
import { markRead, sendInteractive, sendReply, sendTemplate, typing } from "./actions";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));

export function WindowTimer({ closesAt }: { closesAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const end = closesAt ? new Date(closesAt).getTime() : 0;
  const left = end - now;
  if (!closesAt || left <= 0) return <span className="text-sm text-err">24-hour window closed: templates only</span>;
  const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000);
  return <span className={cn("tnum text-sm", left < 3_600_000 ? "text-warn" : "text-muted")}>Window open · {h}h {m}m left</span>;
}

export function MarkRead({ id }: { id: string }) {
  useEffect(() => { markRead(id).catch(() => {}); }, [id]);
  return null;
}

/** j / k move through the list, r focuses the reply box, e closes or reopens. */
export function InboxKeys({ ids, active }: { ids: string[]; active?: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const i = active ? ids.indexOf(active) : -1;
      const go = (j: number) => { const id = ids[Math.max(0, Math.min(ids.length - 1, j))]; if (id) router.push(`/inbox/${id}${location.search}`); };
      if (e.key === "j") { e.preventDefault(); go(i + 1); }
      else if (e.key === "k") { e.preventDefault(); go(i - 1); }
      else if (e.key === "r") { const el = document.querySelector<HTMLElement>("[data-composer]"); if (el) { e.preventDefault(); el.focus(); } }
      else if (e.key === "e") { const b = document.querySelector<HTMLButtonElement>("#status-toggle"); if (b) { e.preventDefault(); b.click(); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, active, router]);
  return null;
}

type Template = { id: string; name: string; category: string | null; language: string | null; slots: string[]; body: string };
type QuickReply = { shortcut: string; title: string; body: string };

export function Composer({ conversationId, windowOpen, canReply, templates, quickReplies, contactName }: {
  conversationId: string; windowOpen: boolean; canReply: boolean; templates: Template[]; quickReplies: QuickReply[]; contactName: string;
}) {
  const [tab, setTab] = useState<"reply" | "note" | "buttons" | "template">(windowOpen ? "reply" : "template");
  const [key, setKey] = useState(newKey);
  const [text, setText] = useState("");
  const [file, setFile] = useState<string>("");
  const [tid, setTid] = useState(templates[0]?.id ?? "");
  const lastTyping = useRef(0);
  const t = templates.find((x) => x.id === tid);
  const matches = useMemo(() => (text.startsWith("/") ? quickReplies.filter((q) => q.shortcut.startsWith(text.slice(1).split(" ")[0])) : []), [text, quickReplies]);
  const done = () => { setKey(newKey()); setText(""); setFile(""); };
  const onType = (v: string) => {
    setText(v);
    if (tab === "reply" && windowOpen && Date.now() - lastTyping.current > 20_000) { lastTyping.current = Date.now(); typing(conversationId).catch(() => {}); }
  };
  if (!canReply) return <p className="border-t border-line p-4 text-sm text-muted">You can read this conversation. Viewers cannot reply.</p>;
  const tabs = [["reply", "Reply"], ["note", "Note"], ["buttons", "Buttons / list"], ["template", "Template"]] as const;
  return (
    <div className="border-t border-line p-3 sm:p-4">
      <div role="tablist" aria-label="Compose" className="mb-2 flex flex-wrap gap-1">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn("rounded-full px-3 py-1 text-sm", tab === id ? "bg-surface font-semibold shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted hover:text-fg")}>{label}</button>
        ))}
      </div>
      {(tab === "reply" || tab === "buttons") && !windowOpen && (
        <p className="rounded-control bg-warn-bg px-3 py-2 text-sm text-warn">The customer has not written in 24 hours, so WhatsApp only allows a template. Use the Template tab.</p>
      )}
      {(tab === "reply" || tab === "note") && (tab === "note" || windowOpen) && (
        <ActionForm action={sendReply} onOk={done} className="flex flex-col gap-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="mode" value={tab} />
          <input type="hidden" name="key" value={key} />
          <label htmlFor="composer" className="sr-only">{tab === "note" ? "Internal note" : `Reply to ${contactName}`}</label>
          <Textarea id="composer" name="body" data-composer value={text} onChange={(e) => onType(e.target.value)} rows={3}
            placeholder={tab === "note" ? "Internal note: only your team sees this" : "Write a reply. Type / for quick replies."}
            className={tab === "note" ? "bg-warn-bg" : undefined} />
          {matches.length > 0 && (
            <ul role="listbox" aria-label="Quick replies" className="max-h-40 overflow-auto rounded-control border border-line bg-raised">
              {matches.map((q) => (
                <li key={q.shortcut}><button type="button" role="option" aria-selected={false} onClick={() => setText(q.body.replace(/\{\{name\}\}/g, contactName))} className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-surface">
                  <span className="font-medium">/{q.shortcut} · {q.title}</span><span className="line-clamp-1 text-xs text-muted">{q.body}</span>
                </button></li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {tab === "reply" && (
              <label className="inline-flex h-9 cursor-pointer items-center rounded-full border border-line px-3.5 text-sm hover:bg-surface">
                <input type="file" name="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0]?.name ?? "")}
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/mpeg,audio/ogg,audio/aac,audio/mp4,application/pdf,text/plain,.docx,.xlsx" />
                {file ? `Attached: ${file}` : "Attach file"}
              </label>
            )}
            <span className="flex-1" />
            <SubmitButton pending="Sending…">{tab === "note" ? "Add note" : "Send"}</SubmitButton>
          </div>
        </ActionForm>
      )}
      {tab === "buttons" && windowOpen && (
        <ActionForm action={sendInteractive} onOk={done} resetOnOk className="grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="key" value={key} />
          <div className="sm:col-span-2"><label htmlFor="ib" className="text-sm font-medium">Message</label><Textarea id="ib" name="body" rows={2} required /></div>
          <div><label htmlFor="it" className="text-sm font-medium">Type</label>
            <Select id="it" name="type"><option value="button">Reply buttons (1 to 3)</option><option value="list">List (1 to 10 options)</option></Select></div>
          <div><label htmlFor="ibt" className="text-sm font-medium">List button text</label><Input id="ibt" name="button" placeholder="Choose" maxLength={20} /></div>
          <div className="sm:col-span-2"><label htmlFor="io" className="text-sm font-medium">Options, one per line</label><Textarea id="io" name="options" rows={3} required /></div>
          <div className="sm:col-span-2 flex justify-end"><SubmitButton pending="Sending…">Send</SubmitButton></div>
        </ActionForm>
      )}
      {tab === "template" && (templates.length ? (
        <ActionForm action={sendTemplate} onOk={done} className="grid gap-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="key" value={key} />
          <div><label htmlFor="tpl" className="text-sm font-medium">Approved template</label>
            <Select id="tpl" name="templateId" value={tid} onChange={(e) => setTid(e.target.value)}>
              {templates.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.language} · {(x.category ?? "").toLowerCase()}</option>)}
            </Select></div>
          {t && <p className="rounded-control bg-surface px-3 py-2 text-sm">{t.body}</p>}
          {t?.slots.map((s) => (
            <div key={`${t.id}-${s}`}><label htmlFor={`slot-${s}`} className="text-sm font-medium">{s}</label>
              <Input id={`slot-${s}`} name={`slot:${s}`} required defaultValue={s === "body.1" ? contactName : ""} /></div>
          ))}
          {t?.category === "MARKETING" && <p className="text-xs text-muted">Marketing templates go only to contacts with a recorded opt-in.</p>}
          <div className="flex justify-end"><SubmitButton pending="Sending…">Send template</SubmitButton></div>
        </ActionForm>
      ) : <p className="text-sm text-muted">No approved templates for this number. Sync or create them in Templates.</p>)}
    </div>
  );
}

/** Opens the thread at the newest message, and follows new ones as live refreshes add them. */
export function ScrollToEnd({ n }: { n: number }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { const list = ref.current?.parentElement; if (list) list.scrollTop = list.scrollHeight; }, [n]);
  return <li ref={ref} aria-hidden className="h-0 shrink-0" />;
}

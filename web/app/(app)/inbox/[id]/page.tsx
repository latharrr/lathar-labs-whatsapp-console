import Link from "next/link";
import { notFound } from "next/navigation";
import { isWindowOpen, windowClosesAt } from "@ll/db";
import { can } from "@ll/db/src/permissions";
import { slots, fromComponents } from "@ll/db/src/templates";
import { ActionForm } from "@/components/action-form";
import { LiveRefresh } from "@/components/live";
import { SubmitButton } from "@/components/submit-button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/field";
import { Select, StatusChip } from "@/components/ui/kit";
import { buttonClass } from "@/components/ui/button";
import { ago } from "@/lib/format";
import { getThread, listConversations, type InboxFilters } from "@/lib/inbox";
import { requirePage } from "@/lib/session";
import { addTag, assign, removeTag, setStatus } from "../actions";
import { Composer, InboxKeys, MarkRead, ScrollToEnd, WindowTimer } from "../client";
import { Bubble, ConversationList } from "../views";

export const metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

export default async function ThreadPage({ params, searchParams }: { params: { id: string }; searchParams: InboxFilters }) {
  const m = await requirePage("inbox.read");
  const [t, list] = await Promise.all([getThread(m, params.id), listConversations(m, searchParams)]);
  if (!t) notFound();
  const { conv } = t;
  const c = conv.contact;
  const name = c.name ?? c.profileName ?? `+${c.waId}`;
  const open = isWindowOpen(conv.lastInboundAt);
  const isTest = conv.phoneNumber.isFixture || conv.phoneNumber.waba.isFixture;
  const canReply = can(m.role, "inbox.reply");
  const canEdit = can(m.role, "contacts.write");
  // notes and messages in one timeline
  const items = [
    ...t.messages.map((x) => ({ at: x.timestamp, kind: "msg" as const, x })),
    ...conv.notes.map((n) => ({ at: n.createdAt, kind: "note" as const, n })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-[340px_1fr] xl:grid-cols-[320px_1fr_300px]">
        <ConversationList data={list} filters={searchParams} activeId={conv.id} className="hidden md:flex md:h-[calc(100vh-140px)]" />

        <section aria-label={`Conversation with ${name}`} className="flex min-h-[70vh] min-w-0 flex-col rounded-card border border-line bg-raised md:h-[calc(100vh-140px)]">
          <header className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Link href={`/inbox${new URLSearchParams(searchParams as Record<string, string>).toString() ? `?${new URLSearchParams(searchParams as Record<string, string>)}` : ""}`} className={buttonClass("ghost", "md:hidden")} aria-label="Back to conversations">←</Link>
            <div className="min-w-0 flex-1 basis-48">
              <h1 className="truncate text-base font-semibold">{name}</h1>
              <p className="tnum truncate text-xs text-muted">+{c.waId} · via {conv.phoneNumber.displayPhoneNumber}</p>
            </div>
            {isTest && <Chip tone="warn">Test account, not connected to Meta</Chip>}
            <WindowTimer closesAt={windowClosesAt(conv.lastInboundAt)?.toISOString() ?? null} />
          </header>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            {can(m.role, "inbox.assign") ? (
              <ActionForm action={assign} className="flex items-center gap-2">
                <input type="hidden" name="conversationId" value={conv.id} />
                <label htmlFor="assignee" className="text-sm text-muted">Assigned to</label>
                <Select id="assignee" name="userId" defaultValue={conv.assigneeId ?? ""} className="h-8 w-auto">
                  <option value="">No one</option>
                  {t.members.map((x) => <option key={x.userId} value={x.userId}>{x.user.name ?? x.user.email}{x.userId === m.userId ? " (you)" : ""}</option>)}
                </Select>
                <SubmitButton variant="secondary" pending="Saving…">Assign</SubmitButton>
              </ActionForm>
            ) : <span className="text-sm text-muted">Assigned to {conv.assignee?.name ?? conv.assignee?.email ?? "no one"}</span>}
            <span className="flex-1" />
            <LiveRefresh types={["message", "status", "outbound", "media"]} />
            {can(m.role, "inbox.assign") && (
              <ActionForm action={setStatus}>
                <input type="hidden" name="conversationId" value={conv.id} />
                <button id="status-toggle" className={buttonClass("secondary")} aria-keyshortcuts="e">{conv.status === "closed" ? "Reopen" : "Close"}</button>
              </ActionForm>
            )}
          </div>

          <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 max-md:max-h-[55vh]" aria-label="Messages">
            {items.length === 0 && <li className="text-sm text-muted">No messages yet.</li>}
            {items.map((i) => i.kind === "msg" ? <Bubble key={i.x.id} m={i.x} /> : (
              <li key={i.n.id} className="mx-auto w-full max-w-[85%] rounded-card border border-dashed border-line-strong bg-warn-bg px-3 py-2 text-sm">
                <span className="font-medium">Note from {i.n.author?.name ?? i.n.author?.email ?? "someone"}</span> · <span className="text-xs text-muted">{ago(i.n.createdAt)}</span>
                <p className="whitespace-pre-wrap">{i.n.body}</p>
              </li>
            ))}
            {t.queued.map((o) => (
              <li key={o.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-card border border-dashed border-line-strong px-3 py-2 text-sm sm:max-w-[70%]">
                  <p className="whitespace-pre-wrap">{String((o.payload as { _preview?: string })._preview ?? "")}</p>
                  <div className="mt-1 flex flex-wrap justify-end gap-1.5 text-xs text-muted"><StatusChip status={o.status} />{o.errorMessage && <span>{o.errorMessage}</span>}</div>
                </div>
              </li>
            ))}
            <ScrollToEnd n={items.length + t.queued.length} />
          </ol>

          <Composer conversationId={conv.id} windowOpen={open} canReply={canReply} contactName={name}
            quickReplies={t.quickReplies.map((q) => ({ shortcut: q.shortcut, title: q.title, body: q.body }))}
            templates={t.templates.map((x) => ({ id: x.id, name: x.name, category: x.category, language: x.language, slots: slots(x.components), body: fromComponents(x.name, x.language ?? "en", x.category ?? "", x.components).body }))} />
        </section>

        <aside aria-label="Contact" className="flex flex-col gap-4 md:col-span-2 xl:col-span-1">
          <Card>
            <h2 className="text-sm font-semibold">Contact</h2>
            <p className="mt-2 font-medium">{name}</p>
            <p className="tnum text-sm text-muted">+{c.waId}{c.email ? ` · ${c.email}` : ""}</p>
            <dl className="mt-3 grid gap-2 text-sm">
              <div><dt className="text-xs text-muted">Marketing opt-in</dt><dd className="mt-0.5"><StatusChip status={c.optInStatus} /></dd></div>
              {c.optInStatus === "opted_in" && <div><dt className="text-xs text-muted">Source and proof</dt><dd>{c.optInSource} · {c.optInAt?.toLocaleDateString("en-IN")}{c.optInProof && <span className="block break-all text-xs text-muted">{c.optInProof}</span>}</dd></div>}
              {c.optInStatus === "opted_out" && <div><dt className="text-xs text-muted">Opted out</dt><dd>{c.optOutAt?.toLocaleDateString("en-IN")} · {c.optOutSource}</dd></div>}
              {c.blocked && <div><dt className="text-xs text-muted">Blocked</dt><dd>Yes, nothing will be sent</dd></div>}
              {c.attributes.map((a) => <div key={a.key}><dt className="text-xs text-muted">{a.key}</dt><dd className="break-words">{a.value}</dd></div>)}
            </dl>
            <Link href={`/contacts/${c.id}`} className="mt-3 inline-block text-sm text-accent underline">Open contact</Link>
          </Card>
          <Card>
            <h2 className="text-sm font-semibold">Tags</h2>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {c.tags.length === 0 && <li className="text-sm text-muted">No tags.</li>}
              {c.tags.map((x) => (
                <li key={x.tagId} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold">
                  {x.tag.name}
                  {canEdit && <ActionForm action={removeTag}><input type="hidden" name="contactId" value={c.id} /><input type="hidden" name="tagId" value={x.tagId} /><button aria-label={`Remove tag ${x.tag.name}`} className="text-muted hover:text-err">×</button></ActionForm>}
                </li>
              ))}
            </ul>
            {canEdit && (
              <ActionForm action={addTag} resetOnOk className="mt-2 flex gap-2">
                <input type="hidden" name="contactId" value={c.id} />
                <label htmlFor="newtag" className="sr-only">New tag</label>
                <Input id="newtag" name="tag" placeholder="Add a tag" className="h-9" maxLength={40} list="taglist" />
                <datalist id="taglist">{list.tags.map((x) => <option key={x.id} value={x.name} />)}</datalist>
                <SubmitButton variant="secondary" pending="…">Add</SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card>
            <h2 className="text-sm font-semibold">Campaign history</h2>
            {c.recipients.length === 0 ? <p className="mt-2 text-sm text-muted">No campaign messages.</p> : (
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">{c.recipients.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><Link href={`/campaigns/${r.campaign.id}`} className="truncate underline">{r.campaign.name}</Link><StatusChip status={r.status} /></li>)}</ul>
            )}
          </Card>
          <Card>
            <h2 className="text-sm font-semibold">Orders and leads</h2>
            {t.events.length === 0 ? <p className="mt-2 text-sm text-muted">No events from your systems yet. Send them with POST /api/v1/events.</p> : (
              <ul className="mt-2 flex flex-col gap-2 text-sm">{t.events.map((e) => (
                <li key={e.id}><span className="font-medium">{e.name}</span> · <span className="text-xs text-muted">{ago(e.createdAt)}</span>
                  <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-muted">{JSON.stringify(e.data).slice(0, 300)}</pre></li>
              ))}</ul>
            )}
          </Card>
        </aside>
      </div>
      <MarkRead id={conv.id} />
      <InboxKeys ids={list.rows.map((r) => r.id)} active={conv.id} />
    </div>
  );
}

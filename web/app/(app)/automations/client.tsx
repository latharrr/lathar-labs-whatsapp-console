"use client";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/kit";
import type { FlowGraph, FlowNode } from "@ll/db/src/automation";
import { saveAutomation, saveFlow } from "./actions";

type Opt = { id: string; label: string };
type Tpl = { id: string; name: string; slots: string[] };

export function AutomationForm({ phones, flows, templates }: { phones: Opt[]; flows: Opt[]; templates: Tpl[] }) {
  const [kind, setKind] = useState("keyword");
  const [tid, setTid] = useState(templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === tid);
  return (
    <ActionForm action={saveAutomation} resetOnOk className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="an"><Input id="an" name="name" required /></Field>
        <Field label="Trigger" htmlFor="ak"><Select id="ak" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="keyword">Keyword in a customer message</option><option value="welcome">First message from a new contact</option>
          <option value="away">Message outside business hours</option><option value="event">Event from your system (API)</option>
        </Select></Field>
        <Field label="Number" htmlFor="ap"><Select id="ap" name="phoneNumberId"><option value="">Every number</option>{phones.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
        <Field label="Priority" htmlFor="apr" hint="Lower runs first when several match."><Input id="apr" name="priority" type="number" defaultValue={100} /></Field>
      </div>
      {kind === "keyword" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Keywords" htmlFor="akw" hint="Comma separated. STOP and your opt-out words never reach automations."><Input id="akw" name="keywords" placeholder="price, menu, hours" /></Field>
          <Field label="Match" htmlFor="am"><Select id="am" name="match"><option value="exact">Whole message equals a keyword</option><option value="contains">Message contains a keyword</option></Select></Field>
        </div>
      )}
      {kind !== "event" ? (
        <>
          <Field label="Reply" htmlFor="ar" hint="Sent as a normal message inside the 24-hour window. {{name}} is the contact's name."><Textarea id="ar" name="reply" rows={3} /></Field>
          <Field label="Or run a flow" htmlFor="af"><Select id="af" name="flowId"><option value="">No flow</option>{flows.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
        </>
      ) : (
        <div className="grid gap-3">
          <Field label="Event name" htmlFor="ae" hint="What your system sends to POST /api/v1/events, e.g. order.placed."><Input id="ae" name="event" required placeholder="order.placed" /></Field>
          <Field label="Template to send" htmlFor="at" hint="Events can arrive any time, so they send an approved template (usually utility)."><Select id="at" name="templateId" value={tid} onChange={(e) => setTid(e.target.value)}>{templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          {t?.slots.map((s) => <Field key={s} label={`Value for ${s}`} htmlFor={`v-${s}`} hint="data:orderId takes a field from the event; field:name the contact's name."><Input id={`v-${s}`} name={`var:${s}`} required defaultValue={s === "body.1" ? "field:name" : "data:"} /></Field>)}
          {templates.length === 0 && <p className="text-sm text-err">No approved templates yet.</p>}
        </div>
      )}
      <div><SubmitButton pending="Saving…">Save automation</SubmitButton></div>
    </ActionForm>
  );
}

const LABEL: Record<string, string> = { message: "Send message", buttons: "Ask with buttons", branch: "Branch", set_attribute: "Set attribute", assign: "Hand to an agent", webhook: "Call a webhook", ai: "AI reply", end: "End" };
const blank = (type: string): FlowNode =>
  type === "message" ? { type, text: "" } : type === "buttons" ? { type, text: "", buttons: [{ id: "b1", title: "" }] } : type === "branch" ? { type, source: "input", op: "contains", value: "" }
  : type === "set_attribute" ? { type, key: "", value: "{{input}}" } : type === "assign" ? { type } : type === "webhook" ? { type, url: "https://" } : type === "ai" ? { type, instructions: "" } : { type: "end" };

function NextSelect({ label, value, ids, onChange, self }: { label: string; value?: string; ids: string[]; onChange: (v: string) => void; self: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">{label}
      <Select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="h-9">
        <option value="">(stop here)</option>{ids.filter((i) => i !== self).map((i) => <option key={i} value={i}>{i}</option>)}
      </Select>
    </label>
  );
}

/** Node editor: each node is a card; connections are chosen from the other nodes. Keyboard friendly by design. */
export function FlowEditor({ id, name: initialName, graph: initial, members, aiReady }: { id: string; name: string; graph: FlowGraph; members: Opt[]; aiReady: boolean }) {
  const [name, setName] = useState(initialName);
  const [g, setG] = useState<FlowGraph>(initial);
  const [newType, setNewType] = useState("message");
  const ids = Object.keys(g.nodes);
  const set = (nid: string, n: FlowNode) => setG({ ...g, nodes: { ...g.nodes, [nid]: n } });
  const remove = (nid: string) => { const nodes = { ...g.nodes }; delete nodes[nid]; setG({ ...g, nodes, start: g.start === nid ? Object.keys(nodes)[0] ?? "" : g.start }); };
  const add = () => { let i = ids.length + 1; while (g.nodes[`n${i}`]) i++; setG({ ...g, nodes: { ...g.nodes, [`n${i}`]: blank(newType) } }); };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Flow name" htmlFor="fname"><Input id="fname" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Starts at" htmlFor="fstart"><Select id="fstart" value={g.start} onChange={(e) => setG({ ...g, start: e.target.value })}>{ids.map((i) => <option key={i}>{i}</option>)}</Select></Field>
      </div>
      <ol className="flex flex-col gap-3">
        {ids.map((nid) => {
          const n = g.nodes[nid];
          return (
            <li key={nid} className="rounded-card border border-line bg-raised p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-xs">{nid}</span>
                <span className="flex-1 text-sm font-semibold">{LABEL[n.type]}{nid === g.start ? " · start" : ""}</span>
                <Button type="button" variant="ghost" onClick={() => remove(nid)}>Remove</Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(n.type === "message" || n.type === "buttons") && <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">Text ({"{{name}}"}, {"{{input}}"})<Textarea rows={2} value={n.text} onChange={(e) => set(nid, { ...n, text: e.target.value })} /></label>}
                {n.type === "buttons" && n.buttons.map((b, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:col-span-2">
                    <label className="flex flex-col gap-1 text-xs text-muted">Button {i + 1}<Input maxLength={20} value={b.title} onChange={(e) => set(nid, { ...n, buttons: n.buttons.map((x, j) => (j === i ? { ...x, title: e.target.value, id: `b${j + 1}` } : x)) })} /></label>
                    <NextSelect label="Then" value={b.next} ids={ids} self={nid} onChange={(v) => set(nid, { ...n, buttons: n.buttons.map((x, j) => (j === i ? { ...x, next: v || undefined } : x)) })} />
                    <Button type="button" variant="ghost" onClick={() => set(nid, { ...n, buttons: n.buttons.filter((_, j) => j !== i) })}>×</Button>
                  </div>
                ))}
                {n.type === "buttons" && n.buttons.length < 3 && <div><Button type="button" onClick={() => set(nid, { ...n, buttons: [...n.buttons, { id: `b${n.buttons.length + 1}`, title: "" }] })}>Add button</Button></div>}
                {n.type === "buttons" && <NextSelect label="If they type something else" value={n.otherwise} ids={ids} self={nid} onChange={(v) => set(nid, { ...n, otherwise: v || undefined })} />}
                {n.type === "branch" && <>
                  <label className="flex flex-col gap-1 text-xs text-muted">Check<Select value={n.source} onChange={(e) => set(nid, { ...n, source: e.target.value as "input" })}><option value="input">Their last message</option><option value="attribute">A contact attribute</option></Select></label>
                  {n.source === "attribute" && <label className="flex flex-col gap-1 text-xs text-muted">Attribute<Input value={n.key ?? ""} onChange={(e) => set(nid, { ...n, key: e.target.value })} /></label>}
                  <label className="flex flex-col gap-1 text-xs text-muted">Condition<Select value={n.op} onChange={(e) => set(nid, { ...n, op: e.target.value as "contains" })}><option value="contains">contains</option><option value="equals">equals</option><option value="exists">is not empty</option></Select></label>
                  {n.op !== "exists" && <label className="flex flex-col gap-1 text-xs text-muted">Value<Input value={n.value ?? ""} onChange={(e) => set(nid, { ...n, value: e.target.value })} /></label>}
                  <NextSelect label="If yes" value={n.yes} ids={ids} self={nid} onChange={(v) => set(nid, { ...n, yes: v || undefined })} />
                  <NextSelect label="If no" value={n.no} ids={ids} self={nid} onChange={(v) => set(nid, { ...n, no: v || undefined })} />
                </>}
                {n.type === "set_attribute" && <>
                  <label className="flex flex-col gap-1 text-xs text-muted">Attribute<Input value={n.key} onChange={(e) => set(nid, { ...n, key: e.target.value })} /></label>
                  <label className="flex flex-col gap-1 text-xs text-muted">Value<Input value={n.value} onChange={(e) => set(nid, { ...n, value: e.target.value })} /></label>
                </>}
                {n.type === "assign" && <label className="flex flex-col gap-1 text-xs text-muted">Agent<Select value={n.userId ?? ""} onChange={(e) => set(nid, { ...n, userId: e.target.value || undefined })}><option value="">Leave unassigned for the team</option>{members.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></label>}
                {n.type === "webhook" && <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">URL (receives the contact, their message and attributes; internal addresses are blocked)<Input value={n.url} onChange={(e) => set(nid, { ...n, url: e.target.value })} /></label>}
                {n.type === "ai" && <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">Business facts the AI may use (it hands off to a person when unsure)
                  <Textarea rows={4} value={n.instructions} onChange={(e) => set(nid, { ...n, instructions: e.target.value })} />
                  {!aiReady && <span className="text-warn">AI replies are off on this server, so this node always hands off to a person.</span>}</label>}
                {"next" in n && <NextSelect label="Then" value={n.next} ids={ids} self={nid} onChange={(v) => set(nid, { ...n, next: v || undefined } as FlowNode)} />}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">Add a node<Select value={newType} onChange={(e) => setNewType(e.target.value)} className="w-56">{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
        <Button type="button" onClick={add}>Add</Button>
        <span className="flex-1" />
        <ActionForm action={saveFlow}>
          <input type="hidden" name="id" value={id} /><input type="hidden" name="name" value={name} /><input type="hidden" name="graph" value={JSON.stringify(g)} />
          <SubmitButton pending="Saving…">Save flow</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}

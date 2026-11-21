"use client";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/kit";
import { previewSegment, saveSegment } from "../actions";

type Cond = { field: string; op: string; value?: string };
const FIELDS: { field: string; label: string; ops: string[]; values?: string[]; hint?: string }[] = [
  { field: "tag", label: "Tag", ops: ["has", "not_has"] },
  { field: "optIn", label: "Marketing opt-in", ops: ["is", "is_not"], values: ["opted_in", "opted_out", "unknown"] },
  { field: "name", label: "Name", ops: ["contains"] },
  { field: "attr", label: "Attribute", ops: ["equals", "contains", "exists", "not_exists"], hint: "key=value, e.g. city=Delhi" },
  { field: "lastInbound", label: "Last message from them", ops: ["within_days", "not_within_days"], hint: "days" },
  { field: "createdAt", label: "Added", ops: ["within_days", "before_days"], hint: "days" },
];
const OP: Record<string, string> = { has: "has", not_has: "does not have", is: "is", is_not: "is not", contains: "contains", equals: "equals", exists: "is set", not_exists: "is not set", within_days: "within the last", not_within_days: "not within the last", before_days: "more than N days ago" };

export function SegmentBuilder({ initial }: { initial?: { id: string; name: string; match: string; conditions: Cond[] } }) {
  const [conds, setConds] = useState<Cond[]>(initial?.conditions.length ? initial.conditions : [{ field: "optIn", op: "is", value: "opted_in" }]);
  const [match, setMatch] = useState(initial?.match ?? "all");
  const set = (i: number, c: Partial<Cond>) => setConds(conds.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const rows = (
    <>
      {conds.map((c, i) => {
        const spec = FIELDS.find((f) => f.field === c.field) ?? FIELDS[0];
        return (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <label className="sr-only" htmlFor={`f${i}`}>Field</label>
            <Select id={`f${i}`} name="field" value={c.field} onChange={(e) => { const s = FIELDS.find((f) => f.field === e.target.value)!; set(i, { field: s.field, op: s.ops[0], value: s.values?.[0] ?? "" }); }}>{FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}</Select>
            <label className="sr-only" htmlFor={`o${i}`}>Condition</label>
            <Select id={`o${i}`} name="op" value={c.op} onChange={(e) => set(i, { op: e.target.value })}>{spec.ops.map((o) => <option key={o} value={o}>{OP[o]}</option>)}</Select>
            <label className="sr-only" htmlFor={`v${i}`}>Value</label>
            {spec.values ? <Select id={`v${i}`} name="value" value={c.value} onChange={(e) => set(i, { value: e.target.value })}>{spec.values.map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}</Select>
              : <Input id={`v${i}`} name="value" value={c.value ?? ""} placeholder={spec.hint ?? "value"} onChange={(e) => set(i, { value: e.target.value })} disabled={c.op === "exists" && c.field !== "attr"} />}
            <Button type="button" variant="ghost" aria-label="Remove condition" onClick={() => setConds(conds.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        );
      })}
    </>
  );
  return (
    <div className="flex flex-col gap-3">
      <ActionForm action={saveSegment} className="flex flex-col gap-3">
        {initial && <input type="hidden" name="segmentId" value={initial.id} />}
        <Field label="Segment name" htmlFor="sn"><Input id="sn" name="name" required defaultValue={initial?.name} /></Field>
        <Field label="Contacts must match" htmlFor="sm"><Select id="sm" name="match" value={match} onChange={(e) => setMatch(e.target.value)}><option value="all">All of these conditions</option><option value="any">Any of these conditions</option></Select></Field>
        {rows}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setConds([...conds, { field: "tag", op: "has", value: "" }])}>Add condition</Button>
          <span className="flex-1" />
          <SubmitButton pending="Saving…">Save segment</SubmitButton>
        </div>
      </ActionForm>
      <ActionForm action={previewSegment} className="flex items-center gap-2">
        <input type="hidden" name="match" value={match} />
        {conds.map((c, i) => <span key={i}><input type="hidden" name="field" value={c.field} /><input type="hidden" name="op" value={c.op} /><input type="hidden" name="value" value={c.value ?? ""} /></span>)}
        <SubmitButton variant="secondary" pending="Counting…">Count matching contacts</SubmitButton>
      </ActionForm>
    </div>
  );
}

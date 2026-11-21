"use client";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/kit";
import { runImport } from "../actions";

// header row only, for the column picker; the server parses the whole file
function headerOf(text: string): string[] {
  const line = text.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "";
  return Array.from(line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)).map((m) => m[1].replace(/^"|"$/g, "").replace(/""/g, '"').trim()).filter((h, i, a) => h || i < a.length - 1);
}

export function ImportForm() {
  const [csv, setCsv] = useState("");
  const [cols, setCols] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [invalid, setInvalid] = useState<{ line: number; value: string }[]>([]);
  const guess = (re: RegExp) => cols.find((c) => re.test(c)) ?? "";
  return (
    <div className="flex flex-col gap-4">
      <Field label="CSV file" htmlFor="file" hint="First row must be column names. Up to 20,000 rows and 5 MB. Numbers without a country code get +91.">
        <input id="file" type="file" accept=".csv,text/csv" className="text-sm" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const text = await f.text();
          setCsv(text);
          setCols(headerOf(text));
        }} />
      </Field>
      {cols.length > 0 && (
        <ActionForm action={runImport} onOk={(s) => setInvalid((s.data?.invalid as typeof invalid) ?? [])} className="flex flex-col gap-3">
          <input type="hidden" name="csv" value={csv} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Phone column" htmlFor="pc"><Select id="pc" name="phoneColumn" defaultValue={guess(/phone|mobile|whatsapp|number/i) || cols[0]}>{cols.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Name column" htmlFor="nc"><Select id="nc" name="nameColumn" defaultValue={guess(/name/i)}><option value="">None</option>{cols.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Email column" htmlFor="ec"><Select id="ec" name="emailColumn" defaultValue={guess(/mail/i)}><option value="">None</option>{cols.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Save these columns as attributes</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">{cols.map((c) => <label key={c} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" name="attr" value={c} /> {c}</label>)}</div>
          </fieldset>
          <Field label="Tag everyone in this file" htmlFor="tag" hint="Optional. Makes the import easy to find and segment."><Input id="tag" name="tag" placeholder="e.g. diwali-signups" /></Field>
          <div className="rounded-control border border-line p-3">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
              <span>Everyone in this file agreed to receive marketing messages on WhatsApp from us. Contacts who already opted out stay opted out.</span></label>
            {consent && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Where consent came from" htmlFor="src"><Input id="src" name="source" required placeholder="e.g. website checkout checkbox" /></Field>
                <Field label="Proof" htmlFor="proof"><Input id="proof" name="proof" required placeholder="e.g. link to the form, or export file name" /></Field>
              </div>
            )}
            {!consent && <p className="mt-2 text-xs text-muted">Without this, contacts are imported with no opt-in: they can get service replies and utility templates, not campaigns.</p>}
          </div>
          <div><SubmitButton pending="Importing…">Import contacts</SubmitButton></div>
        </ActionForm>
      )}
      {invalid.length > 0 && (
        <div className="rounded-control border border-line p-3 text-sm">
          <p className="font-medium">Rows skipped because the number is not valid</p>
          <ul className="mt-1 text-muted">{invalid.map((r) => <li key={r.line} className="tnum">Line {r.line}: {r.value || "(empty)"}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

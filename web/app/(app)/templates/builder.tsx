"use client";
import { useMemo, useState } from "react";
import { useFormState } from "react-dom";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/kit";
import type { Button as TButton, Draft } from "@ll/db/src/templates";
import { saveDraft, uploadHeaderSample } from "./actions";

const count = (s: string) => Array.from(s.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).length;

/** WhatsApp-style preview with sample values filled in. */
export function PhonePreview({ d }: { d: Draft }) {
  const fill = (s: string, ex: string[]) => s.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => ex[Number(n) - 1] || `{{${n}}}`);
  return (
    <div aria-label="Preview" className="mx-auto w-full max-w-[320px] rounded-[28px] border border-line bg-surface p-3">
      <div className="rounded-[20px] bg-bg p-3">
        <p className="mb-2 text-center text-xs text-muted">Preview · sample values</p>
        <div className="rounded-card border border-line bg-raised p-3 text-sm shadow-sm">
          {d.header.format === "TEXT" && <p className="mb-1 font-semibold">{fill(d.header.text ?? "", [d.header.example ?? ""])}</p>}
          {["IMAGE", "VIDEO", "DOCUMENT"].includes(d.header.format) && <div className="mb-2 flex h-28 items-center justify-center rounded-control bg-surface text-xs text-muted">{d.header.format.toLowerCase()} header{d.header.handle ? " (sample uploaded)" : ""}</div>}
          <p className="whitespace-pre-wrap">{fill(d.body, d.bodyExamples) || <span className="text-muted">Body text</span>}</p>
          {d.footer && <p className="mt-1 text-xs text-muted">{d.footer}</p>}
        </div>
        {d.buttons.map((b, i) => (
          <div key={i} className="mt-1 rounded-card border border-line bg-raised py-2 text-center text-sm font-medium text-accent">
            {b.type === "COPY_CODE" ? "Copy code" : b.text || "Button"}{b.type === "URL" ? " ↗" : b.type === "PHONE_NUMBER" ? " ☎" : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TemplateBuilder({ wabas, initial, id }: { wabas: { id: string; name: string; isFixture: boolean }[]; initial?: Draft; id?: string; wabaId?: string }) {
  const [d, setD] = useState<Draft>(initial ?? { name: "", language: "en", category: "MARKETING", header: { format: "NONE" }, body: "", bodyExamples: [], footer: "", buttons: [] });
  const [wabaId, setWabaId] = useState(wabas[0]?.id ?? "");
  const [up, uploadAction] = useFormState(uploadHeaderSample, {});
  const n = count(d.body);
  const examples = useMemo(() => Array.from({ length: n }, (_, i) => d.bodyExamples[i] ?? ""), [n, d.bodyExamples]);
  const patch = (p: Partial<Draft>) => setD({ ...d, ...p });
  const setButton = (i: number, b: Partial<TButton>) => patch({ buttons: d.buttons.map((x, j) => (j === i ? ({ ...x, ...b } as TButton) : x)) });
  const handle = up.data?.handle as string | undefined;
  const draft: Draft = { ...d, bodyExamples: examples, header: { ...d.header, handle: d.header.handle ?? handle } };
  const testAccount = wabas.find((w) => w.id === wabaId)?.isFixture;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {!id && <Field label="Account" htmlFor="waba"><Select id="waba" value={wabaId} onChange={(e) => setWabaId(e.target.value)}>{wabas.map((w) => <option key={w.id} value={w.id}>{w.name}{w.isFixture ? " (test account)" : ""}</option>)}</Select></Field>}
          <Field label="Name" htmlFor="tn" hint="Lowercase letters, numbers and underscores."><Input id="tn" value={d.name} onChange={(e) => patch({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} required /></Field>
          <Field label="Category" htmlFor="tc" hint="Meta can change it on review."><Select id="tc" value={d.category} onChange={(e) => patch({ category: e.target.value as Draft["category"] })}><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option></Select></Field>
          <Field label="Language" htmlFor="tl" hint="e.g. en, en_US, hi"><Input id="tl" value={d.language} onChange={(e) => patch({ language: e.target.value })} /></Field>
        </div>
        <fieldset className="flex flex-col gap-2 rounded-control border border-line p-3">
          <legend className="px-1 text-sm font-medium">Header (optional)</legend>
          <Select aria-label="Header type" value={d.header.format} onChange={(e) => patch({ header: { format: e.target.value as Draft["header"]["format"] } })}>
            <option value="NONE">None</option><option value="TEXT">Text</option><option value="IMAGE">Image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document</option>
          </Select>
          {d.header.format === "TEXT" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="Header text" value={d.header.text ?? ""} maxLength={60} placeholder="Up to 60 characters, one {{1}} allowed" onChange={(e) => patch({ header: { ...d.header, text: e.target.value } })} />
              {count(d.header.text ?? "") > 0 && <Input aria-label="Header sample" value={d.header.example ?? ""} placeholder="Sample for {{1}}" onChange={(e) => patch({ header: { ...d.header, example: e.target.value } })} />}
            </div>
          )}
          {["IMAGE", "VIDEO", "DOCUMENT"].includes(d.header.format) && (
            testAccount ? <p className="text-sm text-muted">A test account cannot upload samples to Meta. Media headers can be submitted from a connected account.</p> : (
              <form action={uploadAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="wabaId" value={wabaId} />
                <input type="file" name="file" aria-label="Sample file" className="text-sm" accept={d.header.format === "IMAGE" ? "image/jpeg,image/png" : d.header.format === "VIDEO" ? "video/mp4" : "application/pdf"} />
                <SubmitButton variant="secondary" pending="Uploading…">Upload sample</SubmitButton>
                {handle && <span className="text-xs text-ok">Sample uploaded</span>}
                {up.error && <span role="alert" className="text-xs text-err">{up.error}</span>}
              </form>
            )
          )}
        </fieldset>
        <Field label="Body" htmlFor="tb" hint="Use {{1}}, {{2}} … for values that change per contact. Up to 1024 characters.">
          <Textarea id="tb" value={d.body} rows={5} maxLength={1024} onChange={(e) => patch({ body: e.target.value })} />
        </Field>
        {n > 0 && (
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-medium">Sample values (Meta reviews these)</legend>
            {examples.map((v, i) => <Input key={i} aria-label={`Sample for {{${i + 1}}}`} placeholder={`Sample for {{${i + 1}}}`} value={v} onChange={(e) => { const ex = [...examples]; ex[i] = e.target.value; patch({ bodyExamples: ex }); }} />)}
          </fieldset>
        )}
        <Field label="Footer (optional)" htmlFor="tf"><Input id="tf" value={d.footer ?? ""} maxLength={60} onChange={(e) => patch({ footer: e.target.value })} /></Field>
        <fieldset className="flex flex-col gap-2 rounded-control border border-line p-3">
          <legend className="px-1 text-sm font-medium">Buttons (optional)</legend>
          {d.buttons.map((b, i) => (
            <div key={i} className="grid gap-2 rounded-control bg-surface p-2 sm:grid-cols-[140px_1fr_1fr_auto]">
              <span className="self-center text-sm font-medium">{{ QUICK_REPLY: "Quick reply", URL: "Website", PHONE_NUMBER: "Call", COPY_CODE: "Copy code" }[b.type]}</span>
              {b.type !== "COPY_CODE" ? <Input aria-label="Button text" value={b.text} maxLength={25} placeholder="Button text" onChange={(e) => setButton(i, { text: e.target.value })} /> : <Input aria-label="Sample code" value={b.example} maxLength={15} placeholder="Sample code" onChange={(e) => setButton(i, { example: e.target.value })} />}
              {b.type === "URL" ? <div className="flex flex-col gap-1"><Input aria-label="URL" value={b.url} placeholder="https://… (optional {{1}} at the end)" onChange={(e) => setButton(i, { url: e.target.value })} />{count(b.url) > 0 && <Input aria-label="URL sample" value={b.example ?? ""} placeholder="Sample for {{1}}" onChange={(e) => setButton(i, { example: e.target.value })} />}</div>
                : b.type === "PHONE_NUMBER" ? <Input aria-label="Phone number" value={b.phone_number} placeholder="+919876543210" onChange={(e) => setButton(i, { phone_number: e.target.value })} /> : <span />}
              <Button type="button" variant="ghost" onClick={() => patch({ buttons: d.buttons.filter((_, j) => j !== i) })}>Remove</Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => patch({ buttons: [...d.buttons, { type: "QUICK_REPLY", text: "" }] })}>Quick reply</Button>
            <Button type="button" onClick={() => patch({ buttons: [...d.buttons, { type: "URL", text: "", url: "https://" }] })}>Website link</Button>
            <Button type="button" onClick={() => patch({ buttons: [...d.buttons, { type: "PHONE_NUMBER", text: "", phone_number: "+91" }] })}>Call</Button>
            <Button type="button" onClick={() => patch({ buttons: [...d.buttons, { type: "COPY_CODE", example: "" }] })}>Copy code</Button>
          </div>
          <p className="text-xs text-muted">To count clicks, point a URL button at your dashboard&apos;s /r/{"{{1}}"} address; campaigns then fill {"{{1}}"} with a tracked link.</p>
        </fieldset>
        <ActionForm action={saveDraft}>
          {id && <input type="hidden" name="id" value={id} />}
          <input type="hidden" name="wabaId" value={wabaId} />
          <input type="hidden" name="draft" value={JSON.stringify(draft)} />
          <SubmitButton pending="Saving…">Save draft</SubmitButton>
        </ActionForm>
      </div>
      <div className="lg:sticky lg:top-6 lg:self-start"><PhonePreview d={draft} /></div>
    </div>
  );
}

"use client";
import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/kit";
import { cn } from "@/lib/cn";
import { createCampaign } from "../actions";

type Phone = { id: string; label: string; wabaId: string; isTest: boolean };
type Tpl = { id: string; name: string; wabaId: string; category: string; slots: string[]; body: string };
type Seg = { id: string; name: string };
type Variant = { templateId: string; weight: number; variables: Record<string, string> };

const STEPS = ["Number", "Audience", "Template", "Variables", "Schedule"] as const;
const SOURCES = [["field:name", "Contact name"], ["field:waId", "Phone number"], ["field:email", "Email"], ["attr:", "Attribute…"], ["text:", "Fixed text…"], ["link:", "Tracked link…"]] as const;

function Mapping({ slot, value, onChange, attrs }: { slot: string; value: string; onChange: (v: string) => void; attrs: string[] }) {
  const kind = (SOURCES.find(([k]) => (k.endsWith(":") ? value.startsWith(k) : value === k))?.[0] ?? "field:name") as string;
  const arg = kind.endsWith(":") ? value.slice(kind.length) : "";
  return (
    <div className="grid gap-2 sm:grid-cols-[120px_1fr_1fr]">
      <span className="self-center font-mono text-[13px]">{slot}</span>
      <Select aria-label={`Value for ${slot}`} value={kind} onChange={(e) => onChange(e.target.value)}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      {kind === "attr:" ? <Select aria-label="Attribute" value={arg} onChange={(e) => onChange(`attr:${e.target.value}`)}><option value="">Choose…</option>{attrs.map((a) => <option key={a}>{a}</option>)}</Select>
        : kind === "text:" ? <Input aria-label="Fixed text" value={arg} onChange={(e) => onChange(`text:${e.target.value}`)} />
        : kind === "link:" ? <Input aria-label="Destination URL" value={arg} placeholder="https://… (UTM added)" onChange={(e) => onChange(`link:${e.target.value}`)} /> : <span />}
    </div>
  );
}

export function CampaignWizard({ phones, templates, segments, attrs }: { phones: Phone[]; templates: Tpl[]; segments: Seg[]; attrs: string[] }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [phoneId, setPhoneId] = useState(phones[0]?.id ?? "");
  const [segmentId, setSegmentId] = useState("");
  const [ab, setAb] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [throttle, setThrottle] = useState(60);
  const [utm, setUtm] = useState({ source: "whatsapp", medium: "broadcast", campaign: "" });
  const phone = phones.find((p) => p.id === phoneId);
  const usable = useMemo(() => templates.filter((t) => t.wabaId === phone?.wabaId), [templates, phone]);
  const setVariant = (i: number, v: Partial<Variant>) => setVariants(variants.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const pickTemplate = (i: number, id: string) => {
    const t = usable.find((x) => x.id === id);
    const vars = Object.fromEntries((t?.slots ?? []).map((s) => [s, s === "body.1" ? "field:name" : s.startsWith("button") ? "link:" : "text:"]));
    const next = [...variants];
    next[i] = { templateId: id, weight: next[i]?.weight ?? 50, variables: vars };
    setVariants(next);
  };
  const shown = ab ? [0, 1] : [0];
  const ready = [
    !!phoneId && !!name.trim(), true,
    shown.every((i) => variants[i]?.templateId),
    shown.every((i) => Object.entries(variants[i]?.variables ?? {}).every(([, v]) => v && !/^(attr|text|link):$/.test(v))),
    when === "now" || !!at,
  ];
  const payload = { name, phoneNumberId: phoneId, segmentId, variants: variants.slice(0, ab ? 2 : 1), scheduledAt: when === "later" && at ? new Date(at).toISOString() : "", throttlePerMinute: throttle, utm: { ...utm, campaign: utm.campaign || name } };

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-1" aria-label="Steps">
        {STEPS.map((s, i) => <li key={s}><button type="button" onClick={() => i <= step && setStep(i)} aria-current={i === step ? "step" : undefined}
          className={cn("rounded-full px-3 py-1 text-sm", i === step ? "bg-surface font-semibold shadow-[inset_0_0_0_1px_var(--border)]" : i < step ? "text-fg" : "text-muted")}>{i + 1}. {s}</button></li>)}
      </ol>

      {step === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign name" htmlFor="cn"><Input id="cn" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Send from" htmlFor="cp" hint={phone?.isTest ? "Test account: sends stay on this machine and never reach WhatsApp." : undefined}>
            <Select id="cp" value={phoneId} onChange={(e) => { setPhoneId(e.target.value); setVariants([]); }}>{phones.map((p) => <option key={p.id} value={p.id}>{p.label}{p.isTest ? " (test account)" : ""}</option>)}</Select>
          </Field>
        </div>
      )}
      {step === 1 && (
        <Field label="Audience" htmlFor="cs" hint="Only contacts with a recorded marketing opt-in are sent to. Everyone else is listed as skipped, with the reason.">
          <Select id="cs" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}><option value="">All contacts</option>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
      )}
      {step === 2 && (
        <div className="flex flex-col gap-3">
          {usable.length === 0 && <p className="text-sm text-err">This number&apos;s account has no approved templates. Create or sync them in Templates.</p>}
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={ab} onChange={(e) => setAb(e.target.checked)} /> A/B test two templates</label>
          {shown.map((i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_140px]">
              <Field label={ab ? `Variant ${"AB"[i]}` : "Template"} htmlFor={`tp${i}`}>
                <Select id={`tp${i}`} value={variants[i]?.templateId ?? ""} onChange={(e) => pickTemplate(i, e.target.value)}><option value="">Choose an approved template…</option>{usable.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.category.toLowerCase()}</option>)}</Select>
              </Field>
              {ab && <Field label="Share %" htmlFor={`w${i}`}><Input id={`w${i}`} type="number" min={1} max={99} value={variants[i]?.weight ?? 50} onChange={(e) => setVariant(i, { weight: Number(e.target.value) })} /></Field>}
              {variants[i] && <p className="rounded-control bg-surface px-3 py-2 text-sm sm:col-span-2">{usable.find((t) => t.id === variants[i].templateId)?.body}</p>}
            </div>
          ))}
        </div>
      )}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          {shown.map((i) => {
            const t = usable.find((x) => x.id === variants[i]?.templateId);
            if (!t) return null;
            return (
              <fieldset key={i} className="flex flex-col gap-2 rounded-control border border-line p-3">
                <legend className="px-1 text-sm font-medium">{ab ? `Variant ${"AB"[i]}: ` : ""}{t.name}</legend>
                {t.slots.length === 0 && <p className="text-sm text-muted">This template has no variables.</p>}
                {t.slots.map((s) => <Mapping key={s} slot={s} attrs={attrs} value={variants[i].variables[s] ?? ""} onChange={(v) => setVariant(i, { variables: { ...variants[i].variables, [s]: v } })} />)}
              </fieldset>
            );
          })}
          <p className="text-xs text-muted">A contact missing a value (for example no name and no WhatsApp name) is skipped, not sent a broken message. Tracked links only work if the template&apos;s URL button points at this dashboard&apos;s /r/{"{{1}}"}.</p>
        </div>
      )}
      {step === 4 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="text-sm font-medium">When</legend>
            <label className="inline-flex items-center gap-2 text-sm"><input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} /> Send when I launch it</label>
            <label className="inline-flex items-center gap-2 text-sm"><input type="radio" name="when" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule (your local time)</label>
            {when === "later" && <Input aria-label="Send at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="sm:w-64" />}
          </fieldset>
          <Field label="Throttle (messages per minute)" htmlFor="th" hint="Slower sends protect your quality rating. Meta's own limits still apply."><Input id="th" type="number" min={1} max={1000} value={throttle} onChange={(e) => setThrottle(Number(e.target.value))} /></Field>
          <div />
          <Field label="UTM source" htmlFor="us"><Input id="us" value={utm.source} onChange={(e) => setUtm({ ...utm, source: e.target.value })} /></Field>
          <Field label="UTM medium" htmlFor="um"><Input id="um" value={utm.medium} onChange={(e) => setUtm({ ...utm, medium: e.target.value })} /></Field>
          <Field label="UTM campaign" htmlFor="uc" hint="Defaults to the campaign name."><Input id="uc" value={utm.campaign} onChange={(e) => setUtm({ ...utm, campaign: e.target.value })} /></Field>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        {step > 0 && <Button type="button" onClick={() => setStep(step - 1)}>Back</Button>}
        <span className="flex-1" />
        {step < STEPS.length - 1 ? <Button type="button" variant="primary" disabled={!ready[step]} onClick={() => setStep(step + 1)}>Next</Button> : (
          <ActionForm action={createCampaign}>
            <input type="hidden" name="campaign" value={JSON.stringify(payload)} />
            <SubmitButton pending="Saving…">Save and review</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

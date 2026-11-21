/**
 * Message templates: our builder draft <-> Meta's component format, validation against Meta's documented
 * limits, and rendering a template send with per-contact values.
 * Components follow developers.facebook.com/documentation/business-messaging/whatsapp/templates/components.
 */
export type Button =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string; example?: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string }
  | { type: "COPY_CODE"; example: string };

export type Draft = {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  header: { format: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT"; text?: string; example?: string; handle?: string };
  body: string;
  bodyExamples: string[];
  footer?: string;
  buttons: Button[];
};

type Component = Record<string, unknown> & { type: string };

const vars = (s: string) => Array.from(s.matchAll(/\{\{\s*(\d+)\s*\}\}/g), (m) => Number(m[1]));

export function validateDraft(d: Draft): string[] {
  const e: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(d.name)) e.push("Name: lowercase letters, numbers and underscores only.");
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(d.language)) e.push("Language: a code such as en, en_US or hi.");
  if (!d.body.trim()) e.push("Body is required.");
  if (d.body.length > 1024) e.push("Body: at most 1024 characters.");
  const bv = vars(d.body);
  if (bv.some((n, i) => n !== i + 1)) e.push("Body variables must be numbered {{1}}, {{2}}, ... in order, each once.");
  if (bv.length !== d.bodyExamples.filter((x) => x.trim()).length) e.push(`Body: give a sample value for each of the ${bv.length} variables.`);
  if (/^\s*\{\{|\}\}\s*$/.test(d.body)) e.push("Body cannot start or end with a variable.");
  if (d.header.format === "TEXT") {
    const t = d.header.text ?? "";
    if (!t.trim() || t.length > 60) e.push("Text header: 1 to 60 characters.");
    const hv = vars(t);
    if (hv.length > 1 || (hv.length === 1 && hv[0] !== 1)) e.push("Text header: at most one variable, {{1}}.");
    if (hv.length === 1 && !d.header.example?.trim()) e.push("Text header: give a sample value for {{1}}.");
  }
  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(d.header.format) && !d.header.handle) e.push("Media header: upload a sample file.");
  if (d.footer && d.footer.length > 60) e.push("Footer: at most 60 characters.");
  if (d.footer && vars(d.footer).length) e.push("Footer cannot contain variables.");
  const count = (t: Button["type"]) => d.buttons.filter((b) => b.type === t).length;
  if (d.buttons.length > 10) e.push("At most 10 buttons.");
  if (count("URL") > 2) e.push("At most 2 URL buttons.");
  if (count("PHONE_NUMBER") > 1) e.push("At most 1 call button.");
  if (count("COPY_CODE") > 1) e.push("At most 1 copy code button.");
  for (const b of d.buttons) {
    if (b.type !== "COPY_CODE" && (!b.text.trim() || b.text.length > 25)) e.push("Button text: 1 to 25 characters.");
    if (b.type === "URL") {
      if (!/^https:\/\//.test(b.url)) e.push("URL buttons need an https:// URL.");
      const uv = vars(b.url);
      if (uv.length > 1 || (uv.length && !/\{\{1\}\}$/.test(b.url))) e.push("URL buttons: one variable, {{1}}, at the end of the URL.");
      if (uv.length && !b.example?.trim()) e.push("URL buttons with a variable need a sample value.");
    }
    if (b.type === "PHONE_NUMBER" && !/^\+[1-9]\d{7,14}$/.test(b.phone_number)) e.push("Call button: phone number in +E.164 format.");
    if (b.type === "COPY_CODE" && (!b.example.trim() || b.example.length > 15)) e.push("Copy code: a sample code of 1 to 15 characters.");
  }
  if (d.category === "AUTHENTICATION") e.push("Authentication templates use Meta's fixed OTP format; create them in WhatsApp Manager.");
  return e;
}

export function toComponents(d: Draft): Component[] {
  const c: Component[] = [];
  if (d.header.format === "TEXT")
    c.push({ type: "HEADER", format: "TEXT", text: d.header.text, ...(vars(d.header.text ?? "").length ? { example: { header_text: [d.header.example] } } : {}) });
  else if (d.header.format !== "NONE") c.push({ type: "HEADER", format: d.header.format, example: { header_handle: [d.header.handle] } });
  c.push({ type: "BODY", text: d.body, ...(d.bodyExamples.length ? { example: { body_text: [d.bodyExamples] } } : {}) });
  if (d.footer) c.push({ type: "FOOTER", text: d.footer });
  if (d.buttons.length)
    c.push({
      type: "BUTTONS",
      buttons: d.buttons.map((b) =>
        b.type === "URL" ? { type: "URL", text: b.text, url: b.url, ...(b.example && vars(b.url).length ? { example: [b.example] } : {}) }
        : b.type === "COPY_CODE" ? { type: "COPY_CODE", example: b.example } : b),
    });
  return c;
}

export function fromComponents(name: string, language: string, category: string, components: unknown): Draft {
  const list = (Array.isArray(components) ? components : []) as Component[];
  const find = (t: string) => list.find((x) => String(x.type).toUpperCase() === t);
  const h = find("HEADER");
  const b = find("BODY");
  const ex = (o: unknown, k: string) => ((o as Record<string, unknown> | undefined)?.[k] ?? []) as unknown[];
  return {
    name, language,
    category: (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category.toUpperCase()) ? category.toUpperCase() : "MARKETING") as Draft["category"],
    header: h
      ? { format: String(h.format ?? "TEXT").toUpperCase() as Draft["header"]["format"], text: h.text as string | undefined, example: String(ex(h.example, "header_text")[0] ?? ""), handle: String(ex(h.example, "header_handle")[0] ?? "") || undefined }
      : { format: "NONE" },
    body: String(b?.text ?? ""),
    bodyExamples: ((ex(b?.example, "body_text")[0] as string[] | undefined) ?? []).map(String),
    footer: find("FOOTER")?.text as string | undefined,
    buttons: ((find("BUTTONS")?.buttons as Record<string, unknown>[] | undefined) ?? []).map((x) => {
      const t = String(x.type).toUpperCase();
      if (t === "URL") return { type: "URL", text: String(x.text), url: String(x.url), example: (x.example as string[] | undefined)?.[0] };
      if (t === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: String(x.text), phone_number: String(x.phone_number) };
      if (t === "COPY_CODE") return { type: "COPY_CODE", example: String((x.example as string) ?? "") };
      return { type: "QUICK_REPLY", text: String(x.text) };
    }) as Button[],
  };
}

/** Slots a send must fill: header.1, body.1..n, button.<i>.1 (URL suffix), button.<i>.code (copy code). */
export function slots(components: unknown): string[] {
  const d = fromComponents("x", "en", "MARKETING", components);
  const s: string[] = [];
  if (d.header.format === "TEXT" && vars(d.header.text ?? "").length) s.push("header.1");
  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(d.header.format)) s.push("header.media");
  for (const n of vars(d.body)) s.push(`body.${n}`);
  d.buttons.forEach((b, i) => {
    if (b.type === "URL" && vars(b.url).length) s.push(`button.${i}.1`);
    if (b.type === "COPY_CODE") s.push(`button.${i}.code`);
  });
  return s;
}

export type ContactLike = { waId: string; name: string | null; profileName: string | null; email: string | null; attributes?: { key: string; value: string }[] };

/**
 * A mapping value is "field:name" | "field:waId" | "field:email" | "attr:<key>" | "text:<literal>" |
 * "link:<https url>" (a tracked short link; the template's URL button must point at <PUBLIC_URL>/r/{{1}}).
 */
export function resolveValue(spec: string, c: ContactLike, makeLink?: (url: string) => string): string {
  const [kind, ...rest] = spec.split(":");
  const arg = rest.join(":");
  if (kind === "text") return arg;
  if (kind === "field") {
    if (arg === "name") return c.name ?? c.profileName ?? "";
    if (arg === "waId") return `+${c.waId}`;
    if (arg === "email") return c.email ?? "";
    return "";
  }
  if (kind === "attr") return c.attributes?.find((a) => a.key === arg)?.value ?? "";
  if (kind === "link") return makeLink ? makeLink(arg) : "";
  return "";
}

/** Graph "template" message object plus a plain-text preview for the inbox. Throws on a missing value. */
export function renderTemplate(t: { name: string; language: string | null; components: unknown }, values: Record<string, string>) {
  const d = fromComponents(t.name, t.language ?? "en", "MARKETING", t.components);
  const need = slots(t.components);
  const missing = need.filter((s) => !values[s]?.trim());
  if (missing.length) throw new Error(`missing value for ${missing.join(", ")}`);
  const comps: Record<string, unknown>[] = [];
  if (values["header.1"]) comps.push({ type: "header", parameters: [{ type: "text", text: values["header.1"] }] });
  if (values["header.media"]) {
    const f = d.header.format.toLowerCase();
    comps.push({ type: "header", parameters: [{ type: f, [f]: { link: values["header.media"] } }] });
  }
  const body = need.filter((s) => s.startsWith("body.")).map((s) => ({ type: "text", text: values[s] }));
  if (body.length) comps.push({ type: "body", parameters: body });
  d.buttons.forEach((b, i) => {
    if (values[`button.${i}.1`]) comps.push({ type: "button", sub_type: "url", index: String(i), parameters: [{ type: "text", text: values[`button.${i}.1`] }] });
    if (values[`button.${i}.code`]) comps.push({ type: "button", sub_type: "copy_code", index: String(i), parameters: [{ type: "coupon_code", coupon_code: values[`button.${i}.code`] }] });
  });
  const fill = (s: string) => s.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => values[`body.${n}`] ?? "");
  return {
    payload: { type: "template", template: { name: t.name, language: { code: t.language ?? "en" }, ...(comps.length ? { components: comps } : {}) } },
    preview: fill(d.body),
  };
}

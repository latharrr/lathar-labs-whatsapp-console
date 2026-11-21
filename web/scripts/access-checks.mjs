// Hands-on access and keyboard checks against the running local app (port 3100, e2e fixtures loaded).
// Drives a real Chrome window: each role opens direct URLs, other-workspace links and the API; then a keyboard-only pass.
// Writes docs/checks/access-keyboard.md and focus screenshots. Run: node scripts/access-checks.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3100";
const ROOT = join(import.meta.dirname, "..", "..");
const F = JSON.parse(readFileSync(join(ROOT, ".data", "e2e-fixtures.json"), "utf8"));
const env = Object.fromEntries(readFileSync(join(ROOT, ".env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const OUT = join(ROOT, "docs", "checks");
const SHOTS = join(ROOT, "docs", "screenshots", "final", "checks");
mkdirSync(OUT, { recursive: true }); mkdirSync(SHOTS, { recursive: true });

const who = {
  owner: { email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD },
  agent: { email: "agent@fixture.local", password: F.password },
  viewer: { email: "viewer@fixture.local", password: F.password },
  "other-workspace owner": { email: "other@fixture.local", password: F.password },
};

const urls = [
  "/", "/inbox", `/inbox/${F.openConversationId}`, "/contacts", `/contacts/${F.mainContactId}`, "/contacts/import", "/api/export/contacts",
  "/templates/new", "/campaigns/new", "/automations", "/analytics", "/api/export/analytics", "/developer", `/developer/events/${F.mainEventId}`,
  "/settings", "/settings/team", "/settings/audit", "/settings/data",
];

const rows = [];
const fails = [];
const browser = await chromium.launch({ channel: "chrome" });

async function classify(page, url) {
  if (url.startsWith("/api/")) {
    // downloads: same cookies, no navigation (a 403 would otherwise leave the tab on Chrome's error page)
    const r = await page.request.get(BASE + url, { maxRedirects: 0 });
    const loc = r.headers().location ?? "";
    if (r.status() >= 300 && r.status() < 400) return loc.includes("/login") ? "sign-in page" : `redirect ${loc}`;
    return r.status() === 200 && (r.headers()["content-type"] ?? "").includes("csv") ? "CSV download" : String(r.status());
  }
  const r = await page.goto(BASE + url);
  // pages behind loading.tsx stream, so a denial redirects in the browser after hydration (no networkidle: the live stream stays open)
  await page.locator("html[data-hydrated]").waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(700);
  const status = r?.status() ?? 0;
  const at = new URL(page.url()).pathname;
  if (at.startsWith("/login")) return "sign-in page";
  const text = await page.locator("body").innerText();
  if (at.startsWith("/no-access") || /You don't have access to that page/.test(text)) return "no access";
  if (status === 404 || /\bNot found\b/.test(text)) return "not found";
  if (/Only Owners and Admins can/.test(text)) return "page, says Owner/Admin only";
  if (status === 403) return "403";
  if (status >= 500) return `error ${status}`;
  const ct = r?.headers()["content-type"] ?? "";
  return ct.includes("csv") ? "CSV download" : "page";
}

async function signIn(page, u) {
  await page.goto(BASE + "/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 15000 });
}

// expected outcome per role; anything else is recorded as a failure
const expectFor = (role, url) => {
  const mainRecord = [F.openConversationId, F.mainContactId, F.mainEventId].some((id) => url.includes(id));
  if (role === "signed out") return "sign-in page";
  if (role === "other-workspace owner") return mainRecord ? "not found" : url.startsWith("/api/export/contacts") || url.startsWith("/api/export/analytics") ? "CSV download" : "page";
  const admin = ["/contacts/import", "/api/export/contacts", "/templates/new", "/campaigns/new", "/api/export/analytics", "/developer", `/developer/events/${F.mainEventId}`, "/settings/audit", "/settings/data"];
  if (role === "owner") return url.startsWith("/api/export") ? "CSV download" : "page";
  if (["/contacts/import", "/developer", "/automations"].includes(url)) return "page, says Owner/Admin only";
  if (admin.includes(url)) return url.startsWith("/api/export") ? "403" : "no access";
  return "page";
};

for (const [role, u] of [["signed out", null], ...Object.entries(who)]) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  if (u) await signIn(page, u);
  for (const url of urls) {
    const got = await classify(page, url).catch((e) => `error: ${e.message.split("\n")[0]}`);
    const want = expectFor(role, url);
    rows.push([role, url.replace(/[a-z0-9]{20,}/g, "<id>"), got, want]);
    if (got !== want) fails.push(`${role} ${url}: got ${got}, expected ${want}`);
  }
  await ctx.close();
}

// The denial for streamed pages happens in the browser, so check the raw HTML never carries the protected data.
const leaks = [];
for (const role of ["agent", "viewer"]) {
  const ctx = await browser.newContext(); const page = await ctx.newPage(); await signIn(page, who[role]);
  for (const [url, marker] of [["/settings/audit", "auth.signin"], ["/developer/events", "phone_number_quality_update"], [`/developer/events/${F.mainEventId}`, "whatsapp_business_account"], ["/templates/new", "Save draft"], ["/campaigns/new", "Campaign name"]]) {
    const html = await (await page.request.get(BASE + url)).text();
    const leaked = html.includes(marker);
    leaks.push([role, url.replace(/[a-z0-9]{20,}/g, "<id>"), marker, leaked ? "PRESENT" : "absent"]);
    if (leaked) fails.push(`${role} raw HTML of ${url} contains "${marker}"`);
  }
  await ctx.close();
}

// API keys: another workspace's key cannot read this workspace's contact; no key = 401
const api = await (await browser.newContext()).request;
const apiChecks = [
  ["no key", await api.get(`${BASE}/api/v1/contacts?phone=%2B15550101001`)],
  ["other workspace's key", await api.get(`${BASE}/api/v1/contacts?phone=%2B15550101001`, { headers: { Authorization: `Bearer ${F.otherKey}` } })],
  ["this workspace's key", await api.get(`${BASE}/api/v1/contacts?phone=%2B15550101001`, { headers: { Authorization: `Bearer ${F.mainKey}` } })],
].map(([k, r]) => [k, r.status()]);
const apiWant = { "no key": 401, "other workspace's key": 404, "this workspace's key": 200 };
for (const [k, s] of apiChecks) if (apiWant[k] !== s) fails.push(`API ${k}: got ${s}, expected ${apiWant[k]}`);

// Keyboard-only pass, both themes
const keys = [];
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await ctx.newPage();
  const step = async (name, fn) => { try { await fn(); keys.push([theme, name, "ok"]); } catch (e) { keys.push([theme, name, `FAILED: ${e.message.split("\n")[0]}`]); fails.push(`keyboard ${theme}: ${name}`); } };
  const focused = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute("aria-label") || a.id || a.getAttribute("name") || a.textContent || a.tagName).trim().slice(0, 40) : ""; });
  await page.goto(BASE + "/login");
  await step("login: Tab reaches Email, Password, Sign in in order; Enter submits", async () => {
    const seen = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Tab"); seen.push(await focused()); }
    if (seen.join("|") !== "email|password|Sign in") throw new Error(`order was ${seen.join(" > ")}`);
    await page.locator("#email").fill(who.owner.email); await page.locator("#password").fill(who.owner.password);
    await page.locator("#password").press("Enter");
    await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 15000 });
    await page.locator("html[data-hydrated]").waitFor();
  });
  await step("focus ring is visible on a nav link (screenshot)", async () => {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${s.outlineWidth} | ${s.boxShadow}`; });
    if (/^none/.test(outline) && outline.endsWith("none")) throw new Error(`no visible focus style: ${outline}`);
    await page.screenshot({ path: join(SHOTS, `${theme}-focus-nav.png`) });
  });
  await step("? opens the shortcuts dialog, Escape closes it", async () => {
    await page.keyboard.press("?");
    await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
    await page.screenshot({ path: join(SHOTS, `${theme}-shortcuts.png`) });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor({ state: "hidden" });
  });
  await step("g then i goes to the Inbox; / focuses search; j opens a conversation", async () => {
    await page.keyboard.press("g"); await page.keyboard.press("i");
    await page.waitForURL(/\/inbox/);
    await page.getByRole("heading", { name: "Inbox" }).waitFor();
    await page.keyboard.press("/");
    if (!(await page.evaluate(() => document.activeElement?.hasAttribute("data-search")))) throw new Error("search not focused");
    await page.keyboard.press("Escape"); await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("j");
    await page.waitForURL(/\/inbox\/.+/);
  });
  await step("r focuses the reply box (window open)", async () => {
    await page.goto(`${BASE}/inbox/${F.openConversationId}`); await page.locator("html[data-hydrated]").waitFor();
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(1000); // mark-read refresh re-renders the composer once
    await page.keyboard.press("r");
    if (!(await page.evaluate(() => document.activeElement?.hasAttribute("data-composer")))) throw new Error("composer not focused");
  });
  await step("a confirm dialog opens from the keyboard and Escape cancels without acting", async () => {
    await page.goto(`${BASE}/contacts/${F.mainContactId}`); await page.locator("html[data-hydrated]").waitFor();
    const del = page.getByRole("button", { name: "Delete contact and data" });
    await del.focus(); await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: join(SHOTS, `${theme}-confirm.png`) });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.reload(); await page.getByRole("heading", { name: /Fixture Customer|E2E/ }).first().waitFor();
  });
  await ctx.close();
}
await browser.close();

const md = [
  "# Access and keyboard checks",
  "",
  `Run ${new Date().toISOString()} against the local production build (port 3100) with the labelled e2e fixtures.`,
  "Driven by `web/scripts/access-checks.mjs` in a real Chrome window; screenshots in `docs/screenshots/final/checks/`.",
  "Limits: one desktop size for the keyboard pass; no screen reader was used; API checks cover read only.",
  "",
  `**Result: ${fails.length ? `${fails.length} unexpected` : "all as expected"}.**`,
  ...(fails.length ? ["", ...fails.map((f) => `- ${f}`)] : []),
  "",
  "## Direct URLs by role",
  "",
  "| Role | URL | Got | Expected |", "|---|---|---|---|",
  ...rows.map((r) => `| ${r.join(" | ")} |`),
  "",
  "## Raw HTML of denied pages (before the browser redirect)",
  "",
  "| Role | URL | Protected marker | In raw HTML |", "|---|---|---|---|",
  ...leaks.map((r) => `| ${r.join(" | ")} |`),
  "",
  "## API keys across workspaces",
  "",
  "| Request | Status | Expected |", "|---|---|---|",
  ...apiChecks.map(([k, s]) => `| ${k} | ${s} | ${apiWant[k]} |`),
  "",
  "## Keyboard only",
  "",
  "| Theme | Step | Result |", "|---|---|---|",
  ...keys.map((k) => `| ${k.join(" | ")} |`),
  "",
].join("\n");
writeFileSync(join(OUT, "access-keyboard.md"), md);
console.log(md);
process.exit(fails.length ? 1 : 0);

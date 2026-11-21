import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { as, F, OWNER, signIn } from "./helpers";

// Screenshot sweep for review: every screen x {desktop, 390px} x {light, dark}, plus special states.
// Run: SCREENS=1 npx playwright test e2e/screens.spec.ts  (writes docs/screenshots/final)
test.skip(!process.env.SCREENS, "screenshot sweep only runs with SCREENS=1");
test.describe.configure({ mode: "serial", timeout: 300_000 });
test.use({ navigationTimeout: 20_000, actionTimeout: 10_000 });

const OUT = join(__dirname, "..", "..", "docs", "screenshots", "final");
const issues: string[] = [];

async function shot(page: Page, dir: string, name: string) {
  await page.locator("html[data-hydrated]").waitFor();
  await page.waitForTimeout(250);
  const measure = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const over = await measure().catch(async () => { await page.waitForLoadState(); return measure(); }); // a live refresh can land mid-check
  if (over > 0) issues.push(`${dir}/${name}: scrolls sideways by ${over}px`);
  mkdirSync(join(OUT, dir), { recursive: true });
  const path = join(OUT, dir, `${name}.png`);
  // shortcut: headless Chrome occasionally never paints a 390px full-page capture; one reload-and-retry, then fail
  await page.screenshot({ path, fullPage: true, timeout: 8000 }).catch(async () => {
    await page.reload();
    await page.locator("html[data-hydrated]").waitFor();
    await page.screenshot({ path, fullPage: true, timeout: 8000 });
  });
}

async function href(page: Page, path: string, prefix: string) {
  await page.goto(path);
  return page.locator(`a[href^="${prefix}"]`).first().getAttribute("href");
}

for (const theme of ["light", "dark"] as const) {
  for (const [label, size] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
    test(`${theme} ${label}`, async ({ page, browser }) => {
      const dir = `${theme}-${label}`;
      await page.setViewportSize(size);
      await page.context().addInitScript((t) => localStorage.setItem("theme", t), theme);
      page.on("console", (m) => { if (m.type() === "error") issues.push(`${dir} console: ${m.text().slice(0, 160)}`); });
      await page.goto("/login");
      await shot(page, dir, "00-login");
      await signIn(page, OWNER);
      const campaign = await href(page, "/campaigns", "/campaigns/c");
      const flow = await href(page, "/automations", "/automations/flows/");
      const template = await href(page, "/templates", "/templates/c");
      const screens: [string, string][] = [
        ["01-overview", "/"], ["02-inbox", "/inbox"], ["03-conversation", `/inbox/${F.openConversationId}`], ["04-conversation-closed-window", `/inbox/${F.closedConversationId}`],
        ["05-contacts", "/contacts"], ["06-contact", `/contacts/${F.mainContactId}`], ["07-contacts-import", "/contacts/import"], ["08-segments", "/contacts/segments"], ["09-custom-fields", "/contacts/fields"],
        ["10-templates", "/templates"], ["11-template", template ?? "/templates"], ["12-template-builder", "/templates/new"],
        ["13-campaigns", "/campaigns"], ["14-campaign", campaign ?? "/campaigns"], ["15-campaign-wizard", "/campaigns/new"],
        ["16-automations", "/automations"], ["17-flow", flow ?? "/automations"], ["18-analytics", "/analytics"],
        ["19-developer-keys", "/developer"], ["20-developer-webhooks", "/developer/webhooks"], ["21-developer-events", "/developer/events"], ["22-developer-event", `/developer/events/${F.mainEventId}`],
        ["23-developer-errors", "/developer/errors"], ["24-developer-api", "/developer/api"],
        ["25-settings-accounts", "/settings"], ["26-settings-profile", "/settings/profile"], ["27-settings-team", "/settings/team"], ["28-settings-messaging", "/settings/messaging"],
        ["29-settings-data", "/settings/data"], ["30-settings-audit", "/settings/audit"], ["31-not-found", "/contacts/does-not-exist"],
      ];
      for (const [name, path] of screens) { await page.goto(path); await shot(page, dir, name); }

      // live updates disconnected: the stream fails, the page says so and keeps working
      await page.route("**/api/stream", (r) => r.abort());
      await page.goto("/inbox");
      await expect(page.getByText("Live updates paused (reconnecting)")).toBeVisible();
      await shot(page, dir, "32-live-disconnected");
      await page.unroute("**/api/stream");

      // later steps each get a fresh context: reusing the tab after sign-out has stalled screenshots at 390px
      const fresh = async () => {
        const ctx = await browser.newContext({ viewport: size });
        await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
        return ctx.newPage();
      };

      // viewer: no access page
      page = await fresh();
      await signIn(page, as("viewer@fixture.local"));
      await page.goto("/developer/events");
      await shot(page, dir, "34-no-access");

      // empty workspace: nothing connected, no data
      page = await fresh();
      await signIn(page, as("empty@fixture.local"));
      for (const [name, path] of [["35-empty-overview", "/"], ["36-empty-inbox", "/inbox"], ["37-empty-contacts", "/contacts"], ["38-empty-templates", "/templates"], ["39-empty-campaigns", "/campaigns"], ["40-empty-analytics", "/analytics"], ["41-empty-settings", "/settings"]] as const) {
        await page.goto(path);
        await shot(page, dir, name);
      }

      // loading (last: the extra tab has stalled later screenshots): hold the next navigation so the skeleton shows (own tab, so the held request can't stall later steps)
      const lp = await fresh();
      await signIn(lp, OWNER);
      await lp.goto("/");
      await lp.locator("html[data-hydrated]").waitFor();
      await lp.waitForTimeout(1500); // let Link prefetch cache the loading boundary
      await lp.route("**/contacts**", async (r) => {
        const h = r.request().headers();
        if (h.rsc && !h["next-router-prefetch"]) await new Promise((ok) => setTimeout(ok, 4000)); // hold only the real navigation
        await r.continue().catch(() => {});
      });
      if (label === "mobile") await lp.getByRole("button", { name: "Open menu" }).click({ timeout: 5000 });
      await lp.getByRole("link", { name: "Contacts" }).locator("visible=true").first().click({ timeout: 5000, noWaitAfter: true });
      await lp.waitForTimeout(900);
      mkdirSync(join(OUT, dir), { recursive: true });
      await lp.screenshot({ path: join(OUT, dir, "33-loading.png"), timeout: 5000 });
      await lp.close();
      writeFileSync(join(OUT, dir, "issues.txt"), issues.filter((i) => i.startsWith(dir)).join("\n") + "\n"); // per combination, so single reruns keep the record
    });
  }
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "issues.txt"), issues.join("\n") + "\n");
});

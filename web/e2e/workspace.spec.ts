import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { confirmDialog, OWNER, signIn, toast } from "./helpers";

test.describe("contacts", () => {
  test.beforeEach(async ({ page }) => signIn(page, OWNER));

  test("CSV import with consent, then opt-out, segment count and export", async ({ page }) => {
    await page.goto("/contacts/import");
    const n = String(Date.now()).slice(-5); // a fresh number each run: opted-out contacts stay opted out on re-import
    const csv = `phone,name,city\n+91 98765 ${n},E2E Import One (test),Pune\n98765${n},dup,\nbad-number,x,\n`;
    await page.getByLabel("CSV file").setInputFiles({ name: "e2e.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("checkbox", { name: "city" }).check();
    await page.getByRole("checkbox", { name: /agreed to receive marketing/ }).check();
    await page.getByLabel("Where consent came from").fill("e2e checkout form");
    await page.getByLabel("Proof").fill("e2e run");
    await page.getByRole("button", { name: "Import contacts" }).click();
    await toast(page, /1 duplicates skipped, 1 invalid/);
    await expect(page.getByText("Line 4: bad-number")).toBeVisible();

    await page.goto(`/contacts?q=9198765${n}`);
    await page.getByRole("link", { name: "E2E Import One (test)" }).first().click();
    await expect(page.getByText("e2e checkout form").first()).toBeVisible();
    await confirmDialog(page, "Record opt-out", "Opt out");
    await toast(page, /Opted out/);

    const r = await page.request.get("/api/export/contacts?view=opted_out");
    expect(r.headers()["content-type"]).toContain("text/csv");
    expect(await r.text()).toContain(`+9198765${n}`);

    await page.goto("/contacts/segments");
    await page.getByLabel("Segment name").fill(`E2E segment ${Date.now()} (test)`);
    await page.getByRole("button", { name: "Count matching contacts" }).click();
    await toast(page, /contacts match/);
    await page.getByRole("button", { name: "Save segment" }).click();
    await toast(page, "Segment saved.");
  });
});

test.describe("templates", () => {
  test("build a draft with a live preview, version it, and test accounts cannot submit", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/templates/new");
    const name = `e2e_template_${Date.now()}`;
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Body").fill("Hello {{1}}, thanks for your order.");
    await page.getByLabel("Sample for {{1}}").fill("Asha");
    await expect(page.getByLabel("Preview")).toContainText("Hello Asha, thanks for your order.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Version 1")).toBeVisible();
    await expect(page.getByText("Test account: cannot submit to Meta")).toBeVisible();
    await confirmDialog(page, "Delete draft", "Delete");
    await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
  });
});

test.describe("developer tools", () => {
  test("create and use an API key, replay an event, look up an error", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/developer");
    await page.getByLabel("Name").fill(`e2e ui key ${Date.now()} (test)`);
    await page.getByRole("button", { name: "Create key" }).click();
    const secret = (await page.getByRole("status").locator("code").textContent())!;
    expect(secret).toMatch(/^ll_live_/);
    const r = await page.request.post("/api/v1/events", { headers: { Authorization: `Bearer ${secret}` }, data: { name: "e2e.ui", data: {} } });
    expect(r.status()).toBe(202);

    await page.goto("/developer/events");
    await page.getByRole("link").filter({ hasText: /\d{4}/ }).first().click();
    await expect(page.getByText("Raw payload")).toBeVisible();
    await confirmDialog(page, "Replay", "Replay");
    await toast(page, /Replayed/);

    await page.goto("/developer/errors?q=131047");
    await expect(page.getByRole("cell", { name: "131047" })).toBeVisible();
  });

  test("outbound webhooks refuse internal addresses", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/developer/webhooks");
    await page.getByLabel("URL").fill("https://169.254.169.254/latest");
    await page.getByRole("button", { name: "Add webhook" }).click();
    await toast(page, /private or internal/);
  });
});

test.describe("settings and team", () => {
  test("invite link: a new person joins with the role given", async ({ page, browser }) => {
    await signIn(page, OWNER);
    await page.goto("/settings/team");
    const email = `e2e-invitee-${Date.now()}@fixture.local`;
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Role", { exact: true }).selectOption("VIEWER");
    await page.getByRole("button", { name: "Create invite link" }).click();
    const link = (await page.getByRole("status").locator("code").textContent())!;
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto(link);
    await expect(p2.getByText(/As viewer/)).toBeVisible();
    await p2.getByLabel("Password", { exact: true }).fill("e2e-invitee-password");
    await p2.getByLabel("Repeat password").fill("e2e-invitee-password");
    await p2.getByRole("button", { name: "Join workspace" }).click();
    await expect(p2.getByText("You joined the workspace")).toBeVisible();
    await p2.goto(link);
    await expect(p2.getByText("This invite no longer works")).toBeVisible();
    await ctx.close();
    await page.goto("/settings/audit?action=team.");
    await expect(page.getByText("team.invite").first()).toBeVisible();
  });

  test("messaging settings keep STOP", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/settings/messaging");
    await page.getByLabel("Opt-out words").fill("UNSUBSCRIBE");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await toast(page, "Keep STOP in the opt-out words.");
  });
});

test.describe("keyboard, accessibility and mobile", () => {
  test.beforeEach(async ({ page }) => signIn(page, OWNER));

  test("shortcuts: ? opens help, g then c goes to contacts, j opens a conversation", async ({ page }) => {
    await page.locator("body").press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await expect(page).toHaveURL(/\/contacts$/);
    await page.goto("/inbox");
    await page.locator("html[data-hydrated]").waitFor();
    await page.keyboard.press("j");
    await expect(page).toHaveURL(/\/inbox\/c/);
    await page.keyboard.press("r");
    await expect(page.locator("[data-composer]")).toBeFocused();
  });

  const PAGES = ["/", "/inbox", "/contacts", "/contacts/segments", "/templates", "/campaigns", "/automations", "/analytics", "/developer", "/settings", "/settings/team", "/settings/messaging"];

  test("no serious accessibility violations on the main pages", async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      await page.locator("html[data-hydrated]").waitFor();
      await expect(page.getByText("Something went wrong on the server"), path).toHaveCount(0);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`), path).toEqual([]);
    }
  });

  test("390px wide: nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of [...PAGES, "/campaigns/new", "/templates/new", "/developer/api"]) {
      await page.goto(path);
      await page.locator("html[data-hydrated]").waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

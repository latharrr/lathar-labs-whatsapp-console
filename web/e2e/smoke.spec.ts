import { expect, test } from "@playwright/test";

const email = process.env.SEED_OWNER_EMAIL!;
const password = process.env.SEED_OWNER_PASSWORD!;

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.locator("html[data-hydrated]").waitFor(); // React is interactive
}

test("wrong password is refused", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/did not match/)).toBeVisible();
});

test("owner sees the labelled fixture overview", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Test account, not connected to Meta")).toBeVisible();
  await expect(page.getByText(/last test event/)).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(0); // a test number never looks live
  await expect(page.getByText(/TIER_1K/)).toHaveText(/1,000 customers \/ 24h/); // codes only as secondary detail
  for (const kpi of ["Sent", "Delivered", "Read", "Replied", "Failed", "Windows opened"])
    await expect(page.getByRole("region", { name: "Message KPIs" }).getByText(kpi, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await expect(page.getByText("Template fixture_order_update rejected")).toBeVisible();
  await expect(page.getByText("not set", { exact: true }).first()).toBeVisible(); // no invented prices
  await expect(page.getByText("PRICING_RATES")).toHaveCount(0);
});

test("the totals line adds up and matches the Sent figure", async ({ page }) => {
  await signIn(page);
  for (const days of [7, 30, 90]) {
    await page.goto(days === 7 ? "/" : `/?days=${days}`);
    const line = (await page.getByTestId("totals").innerText()).replace(/,/g, "");
    const m = /^(\d+) sent = (\d+) delivered \+ (\d+) awaiting receipt \+ (\d+) failed( \+ (\d+) other)?$/.exec(line.trim());
    expect(m, line).not.toBeNull();
    const [sent, delivered, awaiting, failed, other] = [m![1], m![2], m![3], m![4], m![6] ?? "0"].map(Number);
    expect(delivered + awaiting + failed + other).toBe(sent);
    const kpi = (await page.getByRole("region", { name: "Message KPIs" }).locator(".tnum").first().innerText()).replace(/,/g, "");
    expect(Number(kpi)).toBe(sent);
  }
});

test("settings shows the webhook setup and the read-only connect form", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page.getByText("/api/webhooks/meta")).toBeVisible();
  await expect(page.getByText("Test account, not connected to Meta")).toBeVisible();
  await expect(page.getByText(/^Token (OK|valid)$/)).toHaveCount(0);
  await page.locator("html[data-hydrated]").waitFor();
  await expect(page.getByLabel("WhatsApp Business Account ID")).toBeVisible();
  await page.getByLabel("WhatsApp Business Account ID").fill("abc");
  await page.getByLabel("System User access token").fill("x".repeat(30));
  await page.getByRole("button", { name: "Connect account" }).click();
  await expect(page.locator("form").getByText(/numeric ID from WhatsApp Manager/)).toBeVisible();
});

test("mobile: sidebar becomes a drawer and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  // dev mode hydrates late; keep clicking until React has attached the handler
  await expect(async () => {
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

import { expect, test } from "@playwright/test";
import { confirmDialog, eventually, F, inbound, OWNER, pick, signIn, toast } from "./helpers";

const key = { Authorization: `Bearer ${F.mainKey}` };

test.describe("inbox", () => {
  test.beforeEach(async ({ page }) => signIn(page, OWNER));

  test("reply, note, tag, assign and close a conversation", async ({ page }) => {
    await page.goto(`/inbox/${F.openConversationId}`);
    await expect(page.getByText(/Window open/)).toBeVisible();
    const text = `Your order is ready (e2e ${Date.now()})`;
    await page.locator("[data-composer]").fill(text);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await toast(page, "Queued to send.");
    await eventually(page, async () => {
      const bubble = page.getByRole("listitem").filter({ hasText: text });
      await expect(bubble.getByText("Test send, not delivered to WhatsApp")).toBeVisible({ timeout: 2000 });
    });

    await page.getByRole("tab", { name: "Note" }).click();
    await page.locator("[data-composer]").fill("Customer prefers evening pickup (e2e note)");
    await page.getByRole("button", { name: "Add note" }).click();
    await toast(page, "Note added.");
    await expect(page.getByText("Customer prefers evening pickup (e2e note)").first()).toBeVisible();

    await page.getByLabel("New tag").fill("e2e-tag");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await toast(page, "Tagged e2e-tag.");

    await page.getByLabel("Assigned to").selectOption({ label: "Owner (you)" });
    await page.getByRole("button", { name: "Assign" }).click();
    await toast(page, "Assigned.");

    await page.locator("body").click();
    await page.keyboard.press("e");
    await toast(page, /Closed\.|Reopened\./);
    await page.reload();
    const toggle = page.locator("#status-toggle");
    if ((await toggle.textContent()) === "Reopen") { await toggle.click(); await toast(page, "Reopened."); }
  });

  test("a closed window allows templates only, and the server enforces it", async ({ page, request }) => {
    await page.goto(`/inbox/${F.closedConversationId}`);
    await expect(page.getByText("24-hour window closed: templates only")).toBeVisible();
    await page.getByRole("tab", { name: "Reply" }).click();
    await expect(page.getByText(/only allows a template/)).toBeVisible();
    await expect(page.locator("[data-composer]")).toHaveCount(0);
    // the API path goes through the same outbox rules
    const r = await request.post("/api/v1/messages", { headers: key, data: { to: "+15550109901", type: "text", text: "hello", idempotencyKey: `win-${Date.now()}` } });
    expect(r.status()).toBe(422);
    expect((await r.json()).error).toContain("window is closed");
    await page.getByRole("tab", { name: "Template" }).click();
    await pick(page.getByLabel("Approved template"), "fixture_order_ready");
    await page.getByLabel("body.2").fill("A-77");
    await page.getByRole("button", { name: "Send template" }).click();
    await toast(page, "Template queued.");
  });
});

test.describe("consent and the API", () => {
  test("STOP opts a contact out before any automation, and marketing is refused", async ({ page, request }) => {
    const waId = `1555011${String(Date.now()).slice(-4)}`;
    await inbound(request, waId, { type: "text", text: { body: "STOP" } });
    await signIn(page, OWNER);
    await eventually(page, async () => {
      await page.goto(`/contacts?q=${waId}`);
      await expect(page.getByRole("row").filter({ hasText: waId }).getByText("Opted out")).toBeVisible({ timeout: 2000 });
    });
    const r = await request.post("/api/v1/messages", { headers: key, data: { to: `+${waId}`, type: "template", template: { name: "fixture_welcome_offer", values: { "body.1": "x", "button.0.1": "y" } }, idempotencyKey: `stop-${waId}` } });
    expect(r.status()).toBe(422);
    expect((await r.json()).error).toContain("opted out");
  });

  test("API sends: opt-in required for marketing, utility allowed, idempotent", async ({ request }) => {
    const bad = await request.post("/api/v1/messages", { headers: key, data: { to: "+15550109901", type: "template", template: { name: "fixture_welcome_offer", values: { "body.1": "x", "button.0.1": "y" } }, idempotencyKey: `mk-${Date.now()}` } });
    expect(bad.status()).toBe(422);
    expect((await bad.json()).error).toContain("no recorded marketing opt-in");
    const k = `ut-${Date.now()}`;
    const send = () => request.post("/api/v1/messages", { headers: key, data: { to: "+15550109901", type: "template", template: { name: "fixture_order_ready", values: { "body.1": "Asha", "body.2": "A-1" } }, idempotencyKey: k } });
    const [a, b] = [await send(), await send()];
    expect(a.status()).toBe(202);
    expect((await a.json()).id).toBe((await b.json()).id);
    const missing = await request.post("/api/v1/messages", { headers: key, data: { to: "+15550109901", type: "text", text: "x" } });
    expect(missing.status()).toBe(400);
  });

  test("API events and contacts", async ({ request }) => {
    const c = await request.post("/api/v1/contacts", { headers: key, data: { phone: "+15550109906", name: "E2E API contact (test)", attributes: { city: "Pune" }, optIn: { source: "e2e", proof: "test run" } } });
    expect(c.status()).toBe(200);
    expect((await c.json()).optInStatus).toBe("opted_in");
    const e = await request.post("/api/v1/events", { headers: key, data: { name: "e2e.ping", phone: "+15550109906", data: { ok: true } } });
    expect(e.status()).toBe(202);
    expect((await request.post("/api/v1/events", { headers: key, data: { name: "bad name!" } })).status()).toBe(400);
  });
});

test.describe("campaigns", () => {
  test("wizard and pre-send checks; a low-quality number blocks launch", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/campaigns/new");
    const name = `E2E campaign ${Date.now()} (test)`;
    await page.getByLabel("Campaign name").fill(name);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Audience").selectOption({ label: "Test: opted-in customers" });
    await page.getByRole("button", { name: "Next" }).click();
    await pick(page.getByLabel("Template", { exact: true }), "fixture_welcome_offer");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Destination URL").fill("https://example.com/shop");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Throttle (messages per minute)").fill("600");
    await page.getByRole("button", { name: "Save and review" }).click();
    await expect(page.getByRole("heading", { name: "Pre-send checks" })).toBeVisible();
    await expect(page.getByText("Not set").first()).toBeVisible(); // no invented prices
    await expect(page.getByText(/Launching sends nothing to WhatsApp/)).toBeVisible();
    // the test number's quality is flagged low, so launching is blocked (a pre-send check)
    await expect(page.getByText("The number's quality is low.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch" })).toBeDisabled();
    await confirmDialog(page, "Delete draft", "Delete");
  });
});

test.describe("automations", () => {
  test("a keyword automation replies through the outbox", async ({ page, request }) => {
    await signIn(page, OWNER);
    await page.goto("/automations");
    const word = `price${Date.now() % 10000}`;
    await page.getByLabel("Name", { exact: true }).fill(`E2E ${word} (test)`);
    await pick(page.getByLabel("Number", { exact: true }), "555-010-0100");
    await page.getByLabel("Keywords", { exact: true }).fill(word);
    await page.getByLabel("Reply", { exact: true }).fill(`Prices start at 499 (e2e ${word})`);
    await page.getByRole("button", { name: "Save automation" }).click();
    await toast(page, "Automation saved.");
    const waId = `1555012${String(Date.now()).slice(-4)}`;
    await inbound(request, waId, { type: "text", text: { body: word } });
    await eventually(page, async () => {
      await page.goto(`/inbox?view=all&q=${waId}`);
      await page.getByRole("link", { name: /E2E customer/ }).first().click();
      await expect(page.getByText(`Prices start at 499 (e2e ${word})`)).toBeVisible({ timeout: 3000 });
    }, 45_000);
  });
});

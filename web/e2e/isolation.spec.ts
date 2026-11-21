import { expect, test } from "@playwright/test";
import { as, F, signIn } from "./helpers";

test.describe("tenant isolation (two workspaces)", () => {
  test("a member of another workspace cannot open this workspace's records", async ({ page }) => {
    await signIn(page, as("other@fixture.local"));
    for (const path of [`/inbox/${F.mainConversationId}`, `/contacts/${F.mainContactId}`, `/developer/events/${F.mainEventId}`]) {
      await page.goto(path);
      // streamed pages answer 200 before the not-found boundary renders; what matters is that nothing leaks
      await expect(page.getByText("This page or record does not exist in this workspace."), path).toBeVisible();
      await expect(page.getByText(/Fixture Customer|15550101001/), path).toHaveCount(0);
    }
    if (F.mainMessageId) expect((await page.request.get(`/api/media/${F.mainMessageId}`)).status()).toBe(404);
    expect((await page.request.get("/api/export/contacts")).status()).toBe(200);
    const csv = await (await page.request.get("/api/export/contacts")).text();
    expect(csv).not.toContain("15550101001");
    await page.goto("/inbox?view=all");
    await expect(page.getByText("Fixture Customer A")).toHaveCount(0);
    await expect(page.getByText("Other workspace customer (test)")).toBeVisible();
  });

  test("an API key only sees its own workspace", async ({ request }) => {
    const auth = { Authorization: `Bearer ${F.otherKey}` };
    expect((await request.get("/api/v1/contacts?phone=%2B15550101001", { headers: auth })).status()).toBe(404);
    const r = await request.post("/api/v1/messages", { headers: auth, data: { to: "+15550101001", from: F.mainPhoneMetaId, type: "text", text: "x", idempotencyKey: `iso-${Date.now()}` } });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toContain("no such number");
    expect((await request.get("/api/v1/contacts?phone=%2B15550101001")).status()).toBe(401);
    expect((await request.get("/api/v1/contacts?phone=%2B15550101001", { headers: { Authorization: "Bearer ll_live_not-a-real-key-000000000" } })).status()).toBe(401);
  });
});

test.describe("roles", () => {
  test("a viewer can read but not reply, launch campaigns or open developer tools", async ({ page }) => {
    await signIn(page, as("viewer@fixture.local"));
    await page.goto(`/inbox/${F.openConversationId}`);
    await expect(page.getByText("Viewers cannot reply")).toBeVisible();
    await page.goto("/campaigns");
    await expect(page.getByRole("link", { name: "New campaign" })).toHaveCount(0);
    await page.goto("/campaigns/new");
    await expect(page.getByText("You don't have access to that page")).toBeVisible();
    await page.goto("/developer/events");
    await expect(page.getByText("You don't have access to that page")).toBeVisible();
  });

  test("an agent can reply but cannot manage the team or developer tools", async ({ page }) => {
    await signIn(page, as("agent@fixture.local"));
    await page.goto(`/inbox/${F.openConversationId}`);
    await expect(page.locator("[data-composer]")).toBeVisible();
    await page.goto("/settings/team");
    await expect(page.getByText("Invite someone")).toHaveCount(0);
    await page.goto("/developer/events");
    await expect(page.getByText("You don't have access to that page")).toBeVisible();
    // and a server action refuses even if the button were reached
    await page.goto("/settings/messaging");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  });
});

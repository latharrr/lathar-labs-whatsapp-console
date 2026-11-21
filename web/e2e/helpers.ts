import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const F = JSON.parse(readFileSync(join(__dirname, "..", "..", ".data", "e2e-fixtures.json"), "utf8")) as {
  password: string; otherKey: string; mainKey: string; closedConversationId: string; openConversationId: string; mainConversationId: string;
  mainContactId: string; mainEventId: string; mainMessageId?: string; mainPhoneMetaId: string;
};
export const OWNER = { email: process.env.SEED_OWNER_EMAIL!, password: process.env.SEED_OWNER_PASSWORD! };
export const as = (email: string) => ({ email, password: F.password });

export async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.locator("html[data-hydrated]").waitFor();
}

const sign = (b: string) => "sha256=" + createHmac("sha256", process.env.META_APP_SECRET!).update(b).digest("hex");

/** A signed inbound message to the fixture number, as Meta would send it. */
export async function inbound(request: APIRequestContext, from: string, message: Record<string, unknown>, name = "E2E customer (test)") {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "100000000000001", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { display_phone_number: "15550100100", phone_number_id: F.mainPhoneMetaId },
      contacts: [{ wa_id: from, profile: { name } }],
      messages: [{ from, id: `wamid.E2E.${Date.now()}.${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
    } }] }],
  });
  const r = await request.post("/api/webhooks/meta", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) } });
  expect(r.status()).toBe(200);
}

/** Reload until the assertion passes (worker jobs and live updates are asynchronous). */
export async function eventually(page: Page, check: () => Promise<void>, timeout = 30_000) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout, intervals: [1000, 2000, 3000] });
}

export async function confirmDialog(page: Page, open: RegExp | string, confirm: RegExp | string) {
  await page.getByRole("button", { name: open }).first().click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirm }).click();
}

export const toast = (page: Page, text: RegExp | string) => expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible({ timeout: 15_000 });

/** Choose a <select> option by part of its text. */
export async function pick(select: import("@playwright/test").Locator, text: string) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  await select.selectOption(value ?? "");
}

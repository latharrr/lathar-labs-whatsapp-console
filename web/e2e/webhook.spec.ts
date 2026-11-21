import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const secret = process.env.META_APP_SECRET!;
const sign = (b: string) => "sha256=" + createHmac("sha256", secret).update(b).digest("hex");

test("verification handshake echoes the challenge only for the right token", async ({ request }) => {
  const ok = await request.get(`/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${process.env.META_VERIFY_TOKEN}&hub.challenge=4242`);
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe("4242");
  expect((await request.get("/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1")).status()).toBe(403);
});

test("unsigned or wrongly signed events are rejected; signed ones accepted", async ({ request }) => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "100000000000001", changes: [] }], n: Date.now() });
  const headers = { "content-type": "application/json" };
  expect((await request.post("/api/webhooks/meta", { data: body, headers })).status()).toBe(401);
  expect((await request.post("/api/webhooks/meta", { data: body, headers: { ...headers, "x-hub-signature-256": sign(body + " ") } })).status()).toBe(401);
  expect((await request.post("/api/webhooks/meta", { data: body, headers: { ...headers, "x-hub-signature-256": sign(body) } })).status()).toBe(200);
});

test("a signed batch near Meta's 3 MB payload size is accepted, not bounced", async ({ request }) => {
  // unknown WABA id, so it is stored for nobody and processing records "unknown WABA"
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "999999999999999", changes: [{ field: "messages", value: { pad: "x".repeat(2_500_000), n: Date.now() } }] }] });
  const r = await request.post("/api/webhooks/meta", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) } });
  expect(r.status()).toBe(200);
});

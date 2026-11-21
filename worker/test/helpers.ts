import { prisma, encrypt } from "@ll/db";
import { storeWebhook } from "@ll/db/src/ingest";
import { processEvent } from "@ll/db/src/process";

export const WABA = "200000000000001";
export const PHONE = "200000000000101";

export async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Alert","AuditLog","MessageStatus","Message","Conversation","Contact","Template","PhoneNumber","Waba","Membership","User","Organization","WebhookEvent" CASCADE`,
  );
  const org = await prisma.organization.create({ data: { name: "Test org" } });
  const waba = await prisma.waba.create({ data: { orgId: org.id, metaWabaId: WABA, accessTokenEnc: encrypt("t"), isFixture: true } });
  await prisma.phoneNumber.create({ data: { wabaId: waba.id, metaPhoneNumberId: PHONE, displayPhoneNumber: "+1 555-020-0100", isFixture: true } });
  return { org, waba };
}

export function envelope(field: string, value: object, time?: number) {
  return { object: "whatsapp_business_account", entry: [{ id: WABA, ...(time ? { time } : {}), changes: [{ field, value }] }] };
}

export function messages(value: object) {
  return envelope("messages", { messaging_product: "whatsapp", metadata: { display_phone_number: "15550200100", phone_number_id: PHONE }, ...value });
}

export async function deliver(payload: object) {
  const ev = await storeWebhook(prisma, JSON.stringify(payload));
  await processEvent(prisma, ev.id);
  return ev.id;
}

let n = 0;
/** A workspace with a WABA and number. fixture=false means "real" (sends go to the mocked Graph API). */
export async function makeOrg(name: string, opts: { fixture?: boolean; limit?: string } = {}) {
  n++;
  const org = await prisma.organization.create({ data: { name } });
  const waba = await prisma.waba.create({ data: { orgId: org.id, metaWabaId: `3${String(n).padStart(14, "0")}`, accessTokenEnc: encrypt(`EAAtesttoken${n}xxxxxxxxxxxxxxxxxxxx`), isFixture: !!opts.fixture } });
  const phone = await prisma.phoneNumber.create({ data: { wabaId: waba.id, metaPhoneNumberId: `4${String(n).padStart(14, "0")}`, displayPhoneNumber: `+1 555-030-${String(n).padStart(4, "0")}`, isFixture: !!opts.fixture, messagingLimit: opts.limit ?? null, qualityRating: "GREEN" } });
  return { org, waba, phone };
}

export async function makeContact(orgId: string, phoneNumberId: string, waId: string, opts: { optIn?: boolean; windowOpen?: boolean } = {}) {
  const contact = await prisma.contact.create({
    data: { orgId, waId, name: `Test ${waId.slice(-3)}`, ...(opts.optIn ? { optInStatus: "opted_in", optInSource: "test", optInAt: new Date() } : {}) },
  });
  const conv = await prisma.conversation.create({ data: { orgId, phoneNumberId, contactId: contact.id, lastInboundAt: opts.windowOpen ? new Date() : null } });
  return { contact, conv };
}

export type FetchCall = { url: string; init: RequestInit & { headers: Record<string, string> } };
/** Replace global fetch with a queue of responses; records every call. */
export function mockGraph(responses: (Response | Error | (() => Response | Promise<Response>))[]) {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  globalThis.fetch = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init: init as FetchCall["init"] });
    const next = queue.shift() ?? new Response(JSON.stringify({ messages: [{ id: `wamid.MOCK.${calls.length}` }] }), { status: 200 });
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  }) as typeof fetch;
  return calls;
}
export const ok = (id = "wamid.MOCK.ok") => new Response(JSON.stringify({ messages: [{ id }] }), { status: 200 });
export const metaError = (status: number, code: number, message = "error") => new Response(JSON.stringify({ error: { code, message } }), { status });

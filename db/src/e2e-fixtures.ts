/**
 * Local test data for the Playwright suite. Idempotent. Creates a second workspace (to prove isolation),
 * an Agent and a Viewer in the main workspace, a contact whose 24h window is closed, and an API key for the
 * second workspace. Writes ids to ../.data/e2e-fixtures.json. Every name says it is test data.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encrypt, hashPassword, prisma } from "./index";
import { createApiKey } from "./apikeys";

const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-local-only-password";

async function user(email: string, name: string) {
  return prisma.user.upsert({ where: { email }, create: { email, name, passwordHash: await hashPassword(PASSWORD) }, update: { passwordHash: await hashPassword(PASSWORD) } });
}

async function main() {
  const main = await prisma.organization.findFirstOrThrow({ where: { name: "Lathar Labs" } });
  const phone = await prisma.phoneNumber.findFirstOrThrow({ where: { metaPhoneNumberId: "100000000000101" } });
  for (const [email, role] of [["agent@fixture.local", "AGENT"], ["viewer@fixture.local", "VIEWER"]] as const) {
    const u = await user(email, `${role.toLowerCase()} (test)`);
    await prisma.membership.upsert({ where: { orgId_userId: { orgId: main.id, userId: u.id } }, create: { orgId: main.id, userId: u.id, role }, update: { role } });
  }
  // a contact whose window closed 30 hours ago
  const closed = await prisma.contact.upsert({ where: { orgId_waId: { orgId: main.id, waId: "15550109901" } }, create: { orgId: main.id, waId: "15550109901", name: "E2E closed window (test)", isFixture: true }, update: {} });
  const closedConv = await prisma.conversation.upsert({
    where: { phoneNumberId_contactId: { phoneNumberId: phone.id, contactId: closed.id } },
    create: { orgId: main.id, phoneNumberId: phone.id, contactId: closed.id, lastInboundAt: new Date(Date.now() - 30 * 3_600_000), lastMessageAt: new Date(Date.now() - 30 * 3_600_000), lastMessagePreview: "old message" },
    update: { lastInboundAt: new Date(Date.now() - 30 * 3_600_000) },
  });

  // a contact who wrote an hour ago, so the window is open
  const open = await prisma.contact.upsert({ where: { orgId_waId: { orgId: main.id, waId: "15550109900" } }, create: { orgId: main.id, waId: "15550109900", name: "E2E open window (test)", isFixture: true }, update: {} });
  const openConv = await prisma.conversation.upsert({
    where: { phoneNumberId_contactId: { phoneNumberId: phone.id, contactId: open.id } },
    create: { orgId: main.id, phoneNumberId: phone.id, contactId: open.id },
    update: {},
  });
  const t = new Date(Date.now() - 3_600_000);
  await prisma.message.upsert({ where: { wamid: "wamid.E2E.open.1" }, create: { orgId: main.id, wamid: "wamid.E2E.open.1", phoneNumberId: phone.id, conversationId: openConv.id, direction: "IN", type: "text", body: "Hi, is my order ready? (test)", isTest: true, timestamp: t }, update: {} });
  await prisma.conversation.update({ where: { id: openConv.id }, data: { lastInboundAt: t, lastMessageAt: t, lastMessagePreview: "Hi, is my order ready? (test)", status: "open" } });
  await prisma.apiKey.deleteMany({ where: { orgId: main.id, name: "e2e main (test)" } });
  const { key: mainKey } = await createApiKey(prisma, main.id, "e2e main (test)", ["read", "events:write", "messages:send", "contacts:write"]);

  // second workspace with its own test number and a conversation
  const other = (await prisma.organization.findFirst({ where: { name: "E2E Other workspace (test)" } })) ?? (await prisma.organization.create({ data: { name: "E2E Other workspace (test)" } }));
  const ou = await user("other@fixture.local", "other workspace owner (test)");
  await prisma.membership.upsert({ where: { orgId_userId: { orgId: other.id, userId: ou.id } }, create: { orgId: other.id, userId: ou.id, role: "OWNER" }, update: {} });
  const owaba = await prisma.waba.upsert({ where: { metaWabaId: "100000000000002" }, create: { orgId: other.id, metaWabaId: "100000000000002", name: "Other fixture WABA (test data)", accessTokenEnc: encrypt("fixture-token-not-real"), isFixture: true }, update: {} });
  const ophone = await prisma.phoneNumber.upsert({ where: { metaPhoneNumberId: "100000000000201" }, create: { wabaId: owaba.id, metaPhoneNumberId: "100000000000201", displayPhoneNumber: "+1 555-020-0200", verifiedName: "Other fixture number", isFixture: true, status: "CONNECTED" }, update: {} });
  const oc = await prisma.contact.upsert({ where: { orgId_waId: { orgId: other.id, waId: "15550209901" } }, create: { orgId: other.id, waId: "15550209901", name: "Other workspace customer (test)", isFixture: true }, update: {} });
  await prisma.conversation.upsert({ where: { phoneNumberId_contactId: { phoneNumberId: ophone.id, contactId: oc.id } }, create: { orgId: other.id, phoneNumberId: ophone.id, contactId: oc.id }, update: {} });
  await prisma.apiKey.deleteMany({ where: { orgId: other.id, name: "e2e (test)" } });
  const { key } = await createApiKey(prisma, other.id, "e2e (test)", ["read", "events:write", "messages:send", "contacts:write"]);

  const anyConv = await prisma.conversation.findFirstOrThrow({ where: { orgId: main.id, contact: { waId: "15550101001" } } });
  const anyEvent = await prisma.webhookEvent.findFirstOrThrow({ where: { orgId: main.id } });
  const media = await prisma.message.findFirst({ where: { orgId: main.id } });
  const dir = join(__dirname, "..", "..", ".data");
  mkdirSync(dir, { recursive: true });
  // a workspace with nothing connected and no data: empty and not-connected states
  const empty = (await prisma.organization.findFirst({ where: { name: "E2E Empty workspace (test)" } })) ?? (await prisma.organization.create({ data: { name: "E2E Empty workspace (test)" } }));
  const eu = await user("empty@fixture.local", "empty workspace owner (test)");
  await prisma.membership.upsert({ where: { orgId_userId: { orgId: empty.id, userId: eu.id } }, create: { orgId: empty.id, userId: eu.id, role: "OWNER" }, update: {} });

  writeFileSync(join(dir, "e2e-fixtures.json"), JSON.stringify({
    password: PASSWORD, otherKey: key, mainKey, openConversationId: openConv.id, mainPhoneMetaId: phone.metaPhoneNumberId, closedConversationId: closedConv.id, mainConversationId: anyConv.id, mainContactId: anyConv.contactId,
    mainEventId: anyEvent.id, mainMessageId: media?.id, otherOrgId: other.id,
  }, null, 2));
  console.log("e2e fixtures ready");
}

main().finally(() => prisma.$disconnect());

/**
 * Local test data only. Creates the Lathar Labs org, the first Owner, and a FIXTURE WABA + number
 * (isFixture = true, so the UI labels everything from it). Then replays db/fixtures/webhooks and a
 * small generated week of receipts through the real webhook pipeline. Re-running is safe.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, encrypt, hashPassword } from "./index";
import { storeWebhook } from "./ingest";
import { processEvent } from "./process";

const WABA = "100000000000001";
const PHONE = "100000000000101";
const DIR = join(__dirname, "..", "fixtures", "webhooks");

// Shift fixture timestamps so the newest lands 2h ago: they stay inside "last 7 days".
function shift(node: unknown, by: number): unknown {
  if (Array.isArray(node)) return node.map((n) => shift(n, by));
  if (node && typeof node === "object")
    return Object.fromEntries(Object.entries(node).map(([k, v]) =>
      [k, (k === "timestamp" || k === "time") && /^\d+$/.test(String(v))
        ? (typeof v === "number" ? v + by : String(Number(v) + by)) : shift(v, by)]));
  return node;
}

// Deterministic PRNG: the same seed gives the same fixture week every run.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

function generatedWeek(now: number) {
  const r = rng(42);
  const customers = ["15550101001", "15550101002", "15550101003", "15550101004", "15550101005", "15550101006"];
  const cats = ["marketing", "marketing", "utility", "utility", "authentication", "service"];
  const payloads: unknown[] = [];
  for (let d = 6; d >= 0; d--) {
    const statuses: unknown[] = [];
    const messages: unknown[] = [];
    const n = 8 + Math.floor(r() * 10) + (6 - d) * 2;
    for (let i = 0; i < n; i++) {
      const id = `wamid.FIXTURE.gen.${d}.${i}`;
      const to = customers[Math.floor(r() * customers.length)];
      const t = now - d * 86400 - 3 * 3600 - Math.floor(r() * 30000);
      const category = cats[Math.floor(r() * cats.length)];
      const pricing = { billable: true, pricing_model: "PMP", category, type: "regular" };
      const roll = r();
      if (roll < 0.06) {
        const code = [131026, 131049, 130429][Math.floor(r() * 3)];
        statuses.push({ id, status: "failed", timestamp: String(t), recipient_id: to, errors: [{ code, title: "fixture" }] });
        continue;
      }
      statuses.push({ id, status: "sent", timestamp: String(t), recipient_id: to, pricing });
      if (roll < 0.1) continue;
      statuses.push({ id, status: "delivered", timestamp: String(t + 5), recipient_id: to, pricing });
      if (roll < 0.35) continue;
      statuses.push({ id, status: "read", timestamp: String(t + 300), recipient_id: to });
      if (roll > 0.8)
        messages.push({ from: to, id: `wamid.FIXTURE.genin.${d}.${i}`, timestamp: String(t + 600), type: "text", text: { body: "Fixture reply" } });
    }
    payloads.push({
      object: "whatsapp_business_account",
      entry: [{ id: WABA, changes: [{ field: "messages", value: {
        messaging_product: "whatsapp", metadata: { display_phone_number: "15550100100", phone_number_id: PHONE },
        contacts: customers.map((c, k) => ({ wa_id: c, profile: { name: `Fixture Customer ${"ABCDEF"[k]}` } })),
        statuses, messages,
      } }] }],
    });
  }
  return payloads;
}

async function main() {
  const email = process.env.SEED_OWNER_EMAIL;
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!email || !password) throw new Error("set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD in .env");

  const org = (await prisma.organization.findFirst({ where: { name: "Lathar Labs" } }))
    ?? (await prisma.organization.create({ data: { name: "Lathar Labs" } }));
  const user = await prisma.user.upsert({
    where: { email }, create: { email, name: "Owner", passwordHash: await hashPassword(password) }, update: {},
  });
  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } }, create: { orgId: org.id, userId: user.id, role: "OWNER" }, update: {},
  });
  const existed = await prisma.waba.findUnique({ where: { metaWabaId: WABA } });
  const waba = await prisma.waba.upsert({
    where: { metaWabaId: WABA },
    create: { orgId: org.id, metaWabaId: WABA, name: "Fixture WABA (test data)", accessTokenEnc: encrypt("fixture-token-not-real"), isFixture: true, tokenValid: true, tokenCheckedAt: new Date() },
    update: {},
  });
  const phone = await prisma.phoneNumber.upsert({
    where: { metaPhoneNumberId: PHONE },
    create: { wabaId: waba.id, metaPhoneNumberId: PHONE, displayPhoneNumber: "+1 555-010-0100", verifiedName: "Fixture Number", status: "CONNECTED", qualityRating: "GREEN", messagingLimit: "TIER_1K", throughputLevel: "STANDARD", isFixture: true, syncedAt: new Date() },
    update: {},
  });

  if (existed) console.log(`fixture events already loaded for ${email}; not replayed`);
  else await replay(org.name, email);
  await seedPhase2(org.id, waba.id, phone.id);
}

/**
 * Inbox, contacts, templates, campaigns and automation fixtures. Idempotent. Everything that can act
 * (automations, flows) is tied to the fixture number, so it can never fire for a real number later.
 */
async function seedPhase2(orgId: string, wabaId: string, phoneId: string) {
  const base = (process.env.PUBLIC_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3100").replace(/\/$/, "");
  const templates = [
    { id: "fixture-tpl-offer", name: "fixture_welcome_offer", category: "MARKETING", status: "APPROVED", components: [
      { type: "BODY", text: "Hi {{1}}, our new collection is live. Take 10% off this week.", example: { body_text: [["Asha"]] } },
      { type: "FOOTER", text: "Lathar Labs (test template)" },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Shop now", url: `${base}/r/{{1}}`, example: ["abc123"] }, { type: "QUICK_REPLY", text: "Stop promotions" }] },
    ] },
    { id: "fixture-tpl-ready", name: "fixture_order_ready", category: "UTILITY", status: "APPROVED", components: [
      { type: "BODY", text: "Hi {{1}}, your order {{2}} is ready for pickup.", example: { body_text: [["Asha", "A-77"]] } },
    ] },
    { id: "fixture-tpl-feedback", name: "fixture_feedback", category: "MARKETING", status: "PENDING", components: [
      { type: "BODY", text: "How was your visit, {{1}}? Reply with a number from 1 to 5.", example: { body_text: [["Asha"]] } },
    ] },
  ];
  for (const t of templates) {
    const row = await prisma.template.upsert({
      where: { wabaId_metaTemplateId: { wabaId, metaTemplateId: t.id } },
      create: { wabaId, metaTemplateId: t.id, name: t.name, language: "en", category: t.category, status: t.status, quality: "GREEN", components: t.components },
      update: {},
    });
    await prisma.templateVersion.upsert({ where: { templateId_version: { templateId: row.id, version: 1 } }, create: { templateId: row.id, version: 1, category: t.category, language: "en", components: t.components, note: "Test fixture" }, update: {} });
  }
  // consent states for the fixture customers; never overwrites a change made later in the UI
  const optIn = ["15550101001", "15550101002", "15550101003", "15550101004"];
  await prisma.contact.updateMany({ where: { orgId, waId: { in: optIn }, optInSource: null, optOutSource: null }, data: { optInStatus: "opted_in", optInSource: "Test fixture", optInProof: "Local seed data, not real consent", optInAt: new Date() } });
  await prisma.contact.updateMany({ where: { orgId, waId: "15550101005", optInSource: null, optOutSource: null }, data: { optInStatus: "opted_out", optOutSource: "Test fixture", optOutAt: new Date() } });
  const tag = await prisma.tag.upsert({ where: { orgId_name: { orgId, name: "test-vip" } }, create: { orgId, name: "test-vip" }, update: {} });
  for (const waId of optIn.slice(0, 2)) {
    const c = await prisma.contact.findUnique({ where: { orgId_waId: { orgId, waId } } });
    if (!c) continue;
    await prisma.contactTag.upsert({ where: { contactId_tagId: { contactId: c.id, tagId: tag.id } }, create: { contactId: c.id, tagId: tag.id }, update: {} });
    await prisma.contactAttribute.upsert({ where: { contactId_key: { contactId: c.id, key: "city" } }, create: { contactId: c.id, key: "city", value: "Delhi (test)" }, update: {} });
  }
  await prisma.segment.upsert({ where: { orgId_name: { orgId, name: "Test: opted-in customers" } }, create: { orgId, name: "Test: opted-in customers", rules: { match: "all", conditions: [{ field: "optIn", op: "is", value: "opted_in" }] } }, update: {} });
  for (const q of [{ shortcut: "thanks", title: "Thank you", body: "Thanks {{name}}! Anything else I can help with?" }, { shortcut: "hours", title: "Opening hours", body: "We are open Monday to Friday, 9:00 to 18:00 IST." }])
    await prisma.quickReply.upsert({ where: { orgId_shortcut: { orgId, shortcut: q.shortcut } }, create: { orgId, ...q }, update: {} });
  if (!(await prisma.flow.findFirst({ where: { orgId, name: "Test: sales or support" } }))) {
    const flow = await prisma.flow.create({ data: { orgId, name: "Test: sales or support", graph: {
      start: "ask", nodes: {
        ask: { type: "buttons", text: "Hi {{name}}, is this about sales or support?", buttons: [{ id: "b1", title: "Sales", next: "sales" }, { id: "b2", title: "Support", next: "support" }] },
        sales: { type: "set_attribute", key: "interest", value: "sales", next: "thanks" },
        thanks: { type: "message", text: "Thanks! Someone from sales will write to you soon.", next: "end" },
        support: { type: "assign", next: "end" },
        end: { type: "end" },
      } } } });
    await prisma.automation.create({ data: { orgId, phoneNumberId: phoneId, name: "Test: menu keyword", kind: "keyword", flowId: flow.id, config: { keywords: ["menu"], match: "exact" } } });
    await prisma.automation.create({ data: { orgId, phoneNumberId: phoneId, name: "Test: welcome", kind: "welcome", config: { reply: "Thanks for writing to Lathar Labs (test number). We reply within a few hours." } } });
  }
  console.log("phase 2-4 fixtures ready (test templates, consent states, segment, quick replies, flow, automations on the fixture number)");
}

async function replay(orgName: string, email: string) {
  const now = Math.floor(Date.now() / 1000);
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
  const parsed = files.map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));
  const maxTs = Math.max(...JSON.stringify(parsed).match(/"(?:timestamp|time)":"?(\d+)/g)!.map((m) => Number(m.replace(/\D/g, ""))));
  const by = now - 2 * 3600 - maxTs;
  const all = [...generatedWeek(now), ...parsed.map((p) => shift(p, by))];

  let processed = 0;
  for (const p of all) {
    const ev = await storeWebhook(prisma, JSON.stringify(p));
    if ((await processEvent(prisma, ev.id)) === "done") processed++;
  }
  console.log(`seeded org "${orgName}", owner ${email}, fixture number +1 555-010-0100; ${processed} new fixture events processed`);
}

main().finally(() => prisma.$disconnect());

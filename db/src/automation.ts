/**
 * Automations run in the worker after an inbound message is stored. Opt-out and opt-in keywords are handled
 * earlier, in webhook processing, so an automation never answers STOP. Opted-out or blocked contacts get no
 * automated replies at all. All replies go through the outbox, so the 24-hour window and suppression apply.
 */
import type { Flow, FlowRun, Prisma, PrismaClient } from "@prisma/client";
import { aiReply, type AiTurn } from "./ai";
import { normalizePhone } from "./contacts";
import type { Jobs } from "./jobs";
import { emit } from "./outhooks";
import { enqueueSend, SendRefused } from "./send";
import { safeRequest } from "./ssrf";
import { renderTemplate, resolveValue } from "./templates";

export type FlowNode =
  | { type: "message"; text: string; next?: string }
  | { type: "buttons"; text: string; buttons: { id: string; title: string; next?: string }[]; otherwise?: string }
  | { type: "branch"; source: "input" | "attribute"; key?: string; op: "contains" | "equals" | "exists"; value?: string; yes?: string; no?: string }
  | { type: "set_attribute"; key: string; value: string; next?: string }
  | { type: "assign"; userId?: string; next?: string }
  | { type: "webhook"; url: string; next?: string }
  | { type: "ai"; instructions: string; next?: string }
  | { type: "end" };
export type FlowGraph = { start: string; nodes: Record<string, FlowNode> };

export const NODE_TYPES = ["message", "buttons", "branch", "set_attribute", "assign", "webhook", "ai", "end"] as const;

export function validateGraph(g: FlowGraph): string[] {
  const e: string[] = [];
  if (!g.nodes[g.start]) e.push("The start node does not exist.");
  for (const [id, n] of Object.entries(g.nodes)) {
    const targets = [
      "next" in n ? n.next : undefined, n.type === "branch" ? n.yes : undefined, n.type === "branch" ? n.no : undefined,
      n.type === "buttons" ? n.otherwise : undefined, ...(n.type === "buttons" ? n.buttons.map((b) => b.next) : []),
    ].filter(Boolean) as string[];
    for (const t of targets) if (!g.nodes[t]) e.push(`Node ${id} points to a missing node ${t}.`);
    if (n.type === "buttons" && (n.buttons.length < 1 || n.buttons.length > 3)) e.push(`Node ${id}: 1 to 3 buttons.`);
    if (n.type === "buttons" && n.buttons.some((b) => !b.title.trim() || b.title.length > 20)) e.push(`Node ${id}: button titles are 1 to 20 characters.`);
    if ((n.type === "message" || n.type === "buttons") && !n.text.trim()) e.push(`Node ${id} has no text.`);
    if (n.type === "webhook" && !/^https?:\/\//.test(n.url)) e.push(`Node ${id}: webhook URL must start with https://.`);
  }
  return e;
}

type Ctx = { db: PrismaClient; jobs: Jobs; ai?: Parameters<typeof aiReply>[1] };
type Conv = Prisma.ConversationGetPayload<{ include: { contact: { include: { attributes: true } } } }>;

function inputOf(payload: unknown, body: string | null) {
  const m = (payload ?? {}) as Record<string, any>;
  const id = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? m.button?.payload ?? null;
  return { text: (body ?? "").trim(), id: id ? String(id) : null };
}

/** Is `now` inside business hours? { mon: [["09:00","18:00"]], ... } in the workspace timezone; null = always open. */
export function withinBusinessHours(hours: unknown, tz: string, now = new Date()): boolean {
  if (!hours || typeof hours !== "object") return true;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const day = parts.find((p) => p.type === "weekday")!.value.slice(0, 3).toLowerCase();
  const hm = `${parts.find((p) => p.type === "hour")!.value}:${parts.find((p) => p.type === "minute")!.value}`;
  const ranges = ((hours as Record<string, [string, string][]>)[day] ?? []);
  return ranges.some(([a, b]) => hm >= a && hm < b);
}

async function sendText(ctx: Ctx, conv: Conv, text: string, key: string) {
  try {
    await enqueueSend(ctx.db, ctx.jobs, {
      orgId: conv.orgId, phoneNumberId: conv.phoneNumberId, contactId: conv.contactId, kind: "text",
      payload: { type: "text", text: { body: text }, _preview: text }, category: "service", source: "automation", idempotencyKey: key,
    });
    return true;
  } catch (e) {
    if (e instanceof SendRefused) return false;
    throw e;
  }
}

const fill = (s: string, input: string, conv: Conv) =>
  s.replace(/\{\{\s*input\s*\}\}/g, input).replace(/\{\{\s*name\s*\}\}/g, conv.contact.name ?? conv.contact.profileName ?? "");

async function step(ctx: Ctx, run: FlowRun & { flow: Flow }, conv: Conv, input: { text: string; id: string | null } | null) {
  const g = run.flow.graph as FlowGraph;
  const log = [...((run.log as Prisma.JsonArray) ?? [])];
  let nodeId: string | undefined = run.currentNode ?? g.start;
  let status = "running";
  let pending = input;

  // resuming after buttons: route by the reply
  if (run.status === "waiting" && nodeId) {
    const n = g.nodes[nodeId];
    if (n?.type === "buttons" && pending) {
      const hit = n.buttons.find((b) => b.id === pending!.id || b.title.toLowerCase() === pending!.text.toLowerCase());
      nodeId = hit?.next ?? n.otherwise;
      log.push({ node: run.currentNode, reply: hit?.title ?? pending.text });
      if (!nodeId) { status = "handoff"; nodeId = undefined; }
    }
  }

  for (let i = 0; nodeId && i < 25; i++) {
    const n: FlowNode | undefined = g.nodes[nodeId];
    if (!n) { status = "error"; log.push({ node: nodeId, error: "missing node" }); break; }
    const key = `flow:${run.id}:${nodeId}:${log.length}`;
    log.push({ node: nodeId, type: n.type, at: new Date().toISOString() });
    if (n.type === "end") { status = "done"; nodeId = undefined; break; }
    if (n.type === "message") { await sendText(ctx, conv, fill(n.text, pending?.text ?? "", conv), key); nodeId = n.next; continue; }
    if (n.type === "buttons") {
      try {
        await enqueueSend(ctx.db, ctx.jobs, {
          orgId: conv.orgId, phoneNumberId: conv.phoneNumberId, contactId: conv.contactId, kind: "interactive", category: "service", source: "automation", idempotencyKey: key,
          payload: { type: "interactive", interactive: { type: "button", body: { text: fill(n.text, pending?.text ?? "", conv) }, action: { buttons: n.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) } }, _preview: n.text },
        });
      } catch (e) { if (!(e instanceof SendRefused)) throw e; status = "error"; break; }
      status = "waiting";
      break;
    }
    if (n.type === "branch") {
      const subject = n.source === "input" ? pending?.text ?? "" : conv.contact.attributes.find((a) => a.key === n.key)?.value ?? "";
      const v = (n.value ?? "").toLowerCase();
      const ok = n.op === "exists" ? !!subject : n.op === "equals" ? subject.toLowerCase() === v : subject.toLowerCase().includes(v);
      nodeId = ok ? n.yes : n.no;
      continue;
    }
    if (n.type === "set_attribute") {
      const value = fill(n.value, pending?.text ?? "", conv);
      await ctx.db.contactAttribute.upsert({ where: { contactId_key: { contactId: conv.contactId, key: n.key } }, create: { contactId: conv.contactId, key: n.key, value }, update: { value } });
      // later branch nodes in this same run must see the new value
      conv.contact.attributes = [...conv.contact.attributes.filter((a) => a.key !== n.key), { contactId: conv.contactId, key: n.key, value }];
      nodeId = n.next;
      continue;
    }
    if (n.type === "assign") {
      const member = n.userId ? await ctx.db.membership.findFirst({ where: { orgId: conv.orgId, userId: n.userId, role: { in: ["OWNER", "ADMIN", "AGENT"] } } }) : null;
      await ctx.db.conversation.update({ where: { id: conv.id }, data: { assigneeId: member?.userId ?? null, status: "open" } });
      status = "handoff";
      nodeId = undefined;
      break;
    }
    if (n.type === "webhook") {
      try {
        const res = await safeRequest(n.url, { body: JSON.stringify({ conversationId: conv.id, contact: { waId: conv.contact.waId, name: conv.contact.name ?? conv.contact.profileName }, input: pending?.text ?? null, attributes: Object.fromEntries(conv.contact.attributes.map((a) => [a.key, a.value])) }), headers: { "Content-Type": "application/json" } });
        log.push({ node: nodeId, http: res.status });
      } catch (e) {
        log.push({ node: nodeId, error: e instanceof Error ? e.message : "request failed" });
      }
      nodeId = n.next;
      continue;
    }
    if (n.type === "ai") {
      const recent = await ctx.db.message.findMany({ where: { conversationId: conv.id }, orderBy: { timestamp: "desc" }, take: 12, select: { direction: true, body: true } });
      const history: AiTurn[] = recent.reverse().map((m) => ({ role: m.direction === "IN" ? "customer" : "business", text: m.body ?? "" }));
      const r = await aiReply({ instructions: n.instructions, history }, ctx.ai);
      if ("handoff" in r) { log.push({ node: nodeId, handoff: r.handoff }); status = "handoff"; nodeId = undefined; break; }
      await sendText(ctx, conv, r.reply, key);
      nodeId = n.next;
      continue;
    }
  }
  if (nodeId && status === "running") status = "error"; // step limit: probably a loop
  if (!nodeId && status === "running") status = "done";
  await ctx.db.flowRun.update({ where: { id: run.id }, data: { currentNode: nodeId ?? null, status, log: log as Prisma.InputJsonArray } });
  return status;
}

export async function startFlow(ctx: Ctx, flowId: string, conv: Conv, input: { text: string; id: string | null } | null) {
  const flow = await ctx.db.flow.findFirst({ where: { id: flowId, orgId: conv.orgId } });
  if (!flow) return "missing";
  await ctx.db.flowRun.updateMany({ where: { conversationId: conv.id, status: "waiting" }, data: { status: "done" } });
  const run = await ctx.db.flowRun.create({ data: { flowId, conversationId: conv.id }, include: { flow: true } });
  return step(ctx, run, conv, input);
}

export async function handleInboundAutomation(ctx: Ctx, messageId: string, now = new Date()) {
  const m = await ctx.db.message.findUnique({ where: { id: messageId } });
  if (!m || m.direction !== "IN" || !m.conversationId) return "skipped";
  const conv = await ctx.db.conversation.findUniqueOrThrow({ where: { id: m.conversationId }, include: { contact: { include: { attributes: true } } } });
  if (conv.contact.blocked || conv.contact.optInStatus === "opted_out") return "suppressed";
  if (m.type === "reaction") return "skipped";
  const input = inputOf(m.payload, m.body);

  const waiting = await ctx.db.flowRun.findFirst({ where: { conversationId: conv.id, status: "waiting" }, include: { flow: true }, orderBy: { createdAt: "desc" } });
  if (waiting) return step(ctx, waiting, conv, input);

  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: conv.orgId } });
  const autos = await ctx.db.automation.findMany({
    where: { orgId: conv.orgId, enabled: true, kind: { in: ["keyword", "welcome", "away"] }, OR: [{ phoneNumberId: null }, { phoneNumberId: conv.phoneNumberId }] },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  const order = { keyword: 0, welcome: 1, away: 2 } as Record<string, number>;
  autos.sort((a, b) => order[a.kind] - order[b.kind] || a.priority - b.priority);
  const firstInbound = (await ctx.db.message.count({ where: { conversationId: conv.id, direction: "IN" } })) === 1;
  const closed = !withinBusinessHours(org.businessHours, org.timezone, now);

  for (const a of autos) {
    const cfg = a.config as { keywords?: string[]; match?: "exact" | "contains"; reply?: string };
    let hit = false;
    if (a.kind === "keyword") {
      const t = input.text.toLowerCase();
      hit = (cfg.keywords ?? []).some((k) => (cfg.match === "contains" ? t.includes(k.toLowerCase()) : t === k.toLowerCase().trim()));
    } else if (a.kind === "welcome") hit = firstInbound;
    else if (a.kind === "away") hit = closed && (!conv.lastAwayAt || now.getTime() - conv.lastAwayAt.getTime() > 12 * 3_600_000);
    if (!hit) continue;
    await ctx.db.automation.update({ where: { id: a.id }, data: { lastFiredAt: now } });
    if (a.kind === "away") await ctx.db.conversation.update({ where: { id: conv.id }, data: { lastAwayAt: now } });
    if (a.flowId) return startFlow(ctx, a.flowId, conv, input);
    if (cfg.reply) await sendText(ctx, conv, fill(cfg.reply, input.text, conv), `auto:${a.id}:${m.id}`);
    return a.kind;
  }
  return "none";
}

/** POST /api/v1/events: store the event, mark conversions, and fire matching event automations (templates). */
export async function handleApiEvent(ctx: Ctx, orgId: string, e: { name: string; phone?: string; data: Record<string, unknown>; idempotencyKey?: string }) {
  const waId = e.phone ? normalizePhone(e.phone) : null;
  if (e.phone && !waId) throw new SendRefused("phone is not a valid E.164 number");
  const contact = waId ? await ctx.db.contact.upsert({ where: { orgId_waId: { orgId, waId } }, create: { orgId, waId }, update: {}, include: { attributes: true } }) : null;
  const event = await ctx.db.apiEvent.create({ data: { orgId, contactId: contact?.id, name: e.name, data: e.data as Prisma.InputJsonObject } });
  await emit(ctx.db, ctx.jobs, orgId, "api.event", { id: event.id, name: e.name, contactId: contact?.id ?? null });

  // conversion: attribute to the most recent campaign message this contact got in the last 7 days
  if (contact && (e.name === "conversion" || e.name === "order.placed" || e.data.conversion === true)) {
    const r = await ctx.db.campaignRecipient.findFirst({
      where: { contactId: contact.id, status: { in: ["sent", "delivered", "read"] }, convertedAt: null, updatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      orderBy: { updatedAt: "desc" },
    });
    if (r) await ctx.db.campaignRecipient.update({ where: { id: r.id }, data: { convertedAt: new Date() } });
  }

  const results: { automation: string; outcome: string }[] = [];
  if (!contact) return { eventId: event.id, results };
  const autos = await ctx.db.automation.findMany({ where: { orgId, enabled: true, kind: "event" } });
  for (const a of autos.filter((x) => (x.config as { event?: string }).event === e.name)) {
    const cfg = a.config as { templateId: string; variables: Record<string, string> };
    const t = await ctx.db.template.findFirst({ where: { id: cfg.templateId, waba: { orgId } }, include: { waba: { include: { phoneNumbers: true } } } });
    const phoneId = a.phoneNumberId ?? t?.waba.phoneNumbers[0]?.id;
    if (!t || !phoneId || t.status !== "APPROVED") { results.push({ automation: a.id, outcome: "template not approved or no number" }); continue; }
    try {
      const values = Object.fromEntries(Object.entries(cfg.variables ?? {}).map(([slot, spec]) =>
        [slot, spec.startsWith("data:") ? String(e.data[spec.slice(5)] ?? "") : resolveValue(spec, contact)]));
      const r = renderTemplate(t, values);
      await enqueueSend(ctx.db, ctx.jobs, {
        orgId, phoneNumberId: phoneId, contactId: contact.id, kind: "template", category: (t.category ?? "UTILITY").toLowerCase() as "utility",
        payload: { ...r.payload, _preview: r.preview }, source: "api",
        idempotencyKey: e.idempotencyKey ? `event:${orgId}:${e.idempotencyKey}:${a.id}` : `event:${event.id}:${a.id}`,
      });
      await ctx.db.automation.update({ where: { id: a.id }, data: { lastFiredAt: new Date() } });
      results.push({ automation: a.id, outcome: "queued" });
    } catch (err) {
      results.push({ automation: a.id, outcome: err instanceof Error ? err.message : "failed" });
    }
  }
  return { eventId: event.id, results };
}

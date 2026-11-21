"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@ll/db";
import { enqueueSend, SendRefused, type Kind } from "@ll/db/src/send";
import { putObject } from "@ll/db/src/storage";
import { renderTemplate, slots } from "@ll/db/src/templates";
import { audit } from "@/lib/audit";
import { requireCan } from "@/lib/session";
import { act, str, webJobs, type ActionState } from "@/lib/server";

async function conversation(orgId: string, id: string) {
  const c = await prisma.conversation.findFirst({ where: { id, orgId }, include: { contact: true } });
  if (!c) throw new Error("Conversation not found.");
  return c;
}

// Meta's media limits (Cloud API media reference)
const MEDIA: Record<string, { type: "image" | "video" | "audio" | "document"; max: number }> = {
  "image/jpeg": { type: "image", max: 5e6 }, "image/png": { type: "image", max: 5e6 }, "image/webp": { type: "image", max: 5e6 },
  "video/mp4": { type: "video", max: 16e6 }, "video/3gpp": { type: "video", max: 16e6 },
  "audio/mpeg": { type: "audio", max: 16e6 }, "audio/ogg": { type: "audio", max: 16e6 }, "audio/aac": { type: "audio", max: 16e6 }, "audio/mp4": { type: "audio", max: 16e6 },
  "application/pdf": { type: "document", max: 100e6 }, "text/plain": { type: "document", max: 100e6 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { type: "document", max: 100e6 },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { type: "document", max: 100e6 },
};

async function queue(orgId: string, userId: string, conversationId: string, contactId: string, phoneNumberId: string, kind: Kind, payload: Record<string, unknown>, key: string, category: "service" | "marketing" | "utility" | "authentication" = "service") {
  await enqueueSend(prisma, webJobs, { orgId, phoneNumberId, contactId, kind, payload, category, source: "inbox", createdById: userId, idempotencyKey: `inbox:${conversationId}:${key || randomUUID()}` });
}

/** Text, a file, or an internal note. The 24-hour window is enforced in enqueueSend, not here. */
export async function sendReply(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("inbox.reply");
    const c = await conversation(m.orgId, str(f, "conversationId"));
    const body = str(f, "body");
    if (str(f, "mode") === "note") {
      if (!body) throw new SendRefused("Write the note first.");
      await prisma.note.create({ data: { conversationId: c.id, authorId: m.userId, body: body.slice(0, 4000) } });
      await audit(m, "note.add", c.id);
      revalidatePath(`/inbox/${c.id}`);
      return "Note added.";
    }
    const file = f.get("file");
    if (file instanceof File && file.size > 0) {
      const spec = MEDIA[file.type];
      if (!spec) throw new SendRefused("WhatsApp does not accept that file type.");
      if (file.size > spec.max) throw new SendRefused(`That ${spec.type} is over WhatsApp's ${Math.round(spec.max / 1e6)} MB limit.`);
      const key = `${m.orgId}/out/${randomUUID()}`;
      await putObject(key, new Uint8Array(await file.arrayBuffer()), file.type);
      const part: Record<string, unknown> = spec.type === "document" ? { filename: file.name } : {};
      if (body && spec.type !== "audio") part.caption = body.slice(0, 1024);
      await queue(m.orgId, m.userId, c.id, c.contactId, c.phoneNumberId, "media",
        { type: spec.type, [spec.type]: part, _media: { key, mime: file.type, name: file.name }, _preview: body || `[${spec.type}] ${file.name}` }, str(f, "key"));
      await audit(m, "message.send", c.id, { kind: "media" });
    } else {
      if (!body) throw new SendRefused("Write a message first.");
      if (body.length > 4096) throw new SendRefused("WhatsApp text messages are at most 4096 characters.");
      await queue(m.orgId, m.userId, c.id, c.contactId, c.phoneNumberId, "text", { type: "text", text: { body, preview_url: /https?:\/\//.test(body) }, _preview: body }, str(f, "key"));
      await audit(m, "message.send", c.id, { kind: "text" });
    }
    revalidatePath(`/inbox/${c.id}`);
    return "Queued to send.";
  });
}

/** Reply buttons (up to 3) or a list (up to 10 rows). */
export async function sendInteractive(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("inbox.reply");
    const c = await conversation(m.orgId, str(f, "conversationId"));
    const body = str(f, "body");
    const options = str(f, "options").split("\n").map((s) => s.trim()).filter(Boolean);
    if (!body) throw new SendRefused("Write the message text.");
    let interactive;
    if (str(f, "type") === "list") {
      if (options.length < 1 || options.length > 10) throw new SendRefused("A list has 1 to 10 options.");
      if (options.some((o) => o.length > 24)) throw new SendRefused("List options are at most 24 characters.");
      const button = str(f, "button") || "Choose";
      interactive = { type: "list", body: { text: body }, action: { button: button.slice(0, 20), sections: [{ title: "Options", rows: options.map((o, i) => ({ id: `opt_${i + 1}`, title: o })) }] } };
    } else {
      if (options.length < 1 || options.length > 3) throw new SendRefused("Reply buttons: 1 to 3.");
      if (options.some((o) => o.length > 20)) throw new SendRefused("Button titles are at most 20 characters.");
      interactive = { type: "button", body: { text: body }, action: { buttons: options.map((o, i) => ({ type: "reply", reply: { id: `btn_${i + 1}`, title: o } })) } };
    }
    await queue(m.orgId, m.userId, c.id, c.contactId, c.phoneNumberId, "interactive", { type: "interactive", interactive, _preview: `${body} [${options.join(" / ")}]` }, str(f, "key"));
    await audit(m, "message.send", c.id, { kind: "interactive" });
    revalidatePath(`/inbox/${c.id}`);
    return "Queued to send.";
  });
}

/** Templates work outside the window. Marketing templates still need an opt-in (checked in enqueueSend). */
export async function sendTemplate(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("inbox.reply");
    const c = await conversation(m.orgId, str(f, "conversationId"));
    const t = await prisma.template.findFirst({ where: { id: str(f, "templateId"), status: "APPROVED", waba: { orgId: m.orgId, phoneNumbers: { some: { id: c.phoneNumberId } } } } });
    if (!t) throw new SendRefused("Pick an approved template for this number.");
    const values = Object.fromEntries(slots(t.components).map((s) => [s, str(f, `slot:${s}`)]));
    let r;
    try { r = renderTemplate(t, values); } catch (e) { throw new SendRefused(e instanceof Error ? `Fill in every variable (${e.message}).` : "Fill in every variable."); }
    await queue(m.orgId, m.userId, c.id, c.contactId, c.phoneNumberId, "template", { ...r.payload, _preview: r.preview }, str(f, "key"), ((t.category ?? "UTILITY").toLowerCase()) as "utility");
    await audit(m, "message.send", c.id, { kind: "template", template: t.name });
    revalidatePath(`/inbox/${c.id}`);
    return "Template queued.";
  });
}

export async function assign(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("inbox.assign");
    const c = await conversation(m.orgId, str(f, "conversationId"));
    const who = str(f, "userId");
    const target = who ? await prisma.membership.findFirst({ where: { orgId: m.orgId, userId: who === "me" ? m.userId : who, role: { in: ["OWNER", "ADMIN", "AGENT"] } } }) : null;
    if (who && !target) throw new Error("That person cannot take conversations in this workspace.");
    await prisma.conversation.update({ where: { id: c.id }, data: { assigneeId: target?.userId ?? null } });
    await audit(m, "conversation.assign", c.id, { to: target?.userId ?? null });
    revalidatePath("/inbox", "layout");
    return target ? "Assigned." : "Unassigned.";
  });
}

export async function setStatus(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("inbox.assign");
    const c = await conversation(m.orgId, str(f, "conversationId"));
    const closed = c.status !== "closed";
    await prisma.conversation.update({ where: { id: c.id }, data: { status: closed ? "closed" : "open", closedAt: closed ? new Date() : null } });
    await audit(m, closed ? "conversation.close" : "conversation.reopen", c.id);
    revalidatePath("/inbox", "layout");
    return closed ? "Closed." : "Reopened.";
  });
}

export async function addTag(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.write");
    const contact = await prisma.contact.findFirst({ where: { id: str(f, "contactId"), orgId: m.orgId } });
    const name = str(f, "tag").slice(0, 40);
    if (!contact || !name) throw new Error("Pick a contact and a tag name.");
    const tag = await prisma.tag.upsert({ where: { orgId_name: { orgId: m.orgId, name } }, create: { orgId: m.orgId, name }, update: {} });
    await prisma.contactTag.upsert({ where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } }, create: { contactId: contact.id, tagId: tag.id }, update: {} });
    await audit(m, "contact.tag", contact.id, { tag: name });
    revalidatePath("/inbox", "layout");
    revalidatePath(`/contacts/${contact.id}`);
    return `Tagged ${name}.`;
  });
}

export async function removeTag(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("contacts.write");
    const tag = await prisma.tag.findFirst({ where: { id: str(f, "tagId"), orgId: m.orgId } });
    const contact = await prisma.contact.findFirst({ where: { id: str(f, "contactId"), orgId: m.orgId } });
    if (!tag || !contact) throw new Error("Not found.");
    await prisma.contactTag.deleteMany({ where: { contactId: contact.id, tagId: tag.id } });
    await audit(m, "contact.untag", contact.id, { tag: tag.name });
    revalidatePath("/inbox", "layout");
    revalidatePath(`/contacts/${contact.id}`);
    return "Tag removed.";
  });
}

/** Opening a conversation: clear the unread count and send Meta a read receipt for the newest customer message. */
export async function markRead(conversationId: string) {
  const m = await requireCan("inbox.read");
  const c = await prisma.conversation.findFirst({ where: { id: conversationId, orgId: m.orgId } });
  if (!c) return;
  await prisma.conversation.update({ where: { id: c.id }, data: { unread: 0 } });
  if (m.role === "VIEWER") return; // viewers should not send read receipts on the business's behalf
  const last = await prisma.message.findFirst({ where: { conversationId: c.id, direction: "IN" }, orderBy: { timestamp: "desc" } });
  if (!last || Date.now() - last.timestamp.getTime() > 29 * 86_400_000) return; // Meta: within 30 days
  await enqueueSend(prisma, webJobs, { orgId: m.orgId, phoneNumberId: c.phoneNumberId, contactId: c.contactId, kind: "read", category: "service", source: "inbox", payload: { status: "read", message_id: last.wamid }, idempotencyKey: `read:${last.wamid}` }).catch(() => {});
}

/** Typing indicator: Meta shows it for up to 25 seconds or until we reply. At most one per 20 seconds. */
export async function typing(conversationId: string) {
  const m = await requireCan("inbox.reply");
  const c = await prisma.conversation.findFirst({ where: { id: conversationId, orgId: m.orgId } });
  if (!c) return;
  const last = await prisma.message.findFirst({ where: { conversationId: c.id, direction: "IN" }, orderBy: { timestamp: "desc" } });
  if (!last) return;
  await enqueueSend(prisma, webJobs, {
    orgId: m.orgId, phoneNumberId: c.phoneNumberId, contactId: c.contactId, kind: "read", category: "service", source: "inbox",
    payload: { status: "read", message_id: last.wamid, typing_indicator: { type: "text" } }, idempotencyKey: `typing:${last.wamid}:${Math.floor(Date.now() / 20_000)}`,
  }).catch(() => {});
}

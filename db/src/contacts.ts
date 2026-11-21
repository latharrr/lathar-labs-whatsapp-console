import type { PrismaClient } from "@prisma/client";
import { applyOptIn } from "./optout";
import { deleteObject } from "./storage";

/**
 * "+91 98765-43210", "0091 98765 43210", "9876543210" (with default country 91) -> "919876543210".
 * shortcut: checks E.164 shape (8-15 digits, no leading 0), not per-country numbering plans; use libphonenumber if imports need that.
 */
export function normalizePhone(raw: string, defaultCc = process.env.DEFAULT_COUNTRY_CODE ?? "91"): string | null {
  let s = String(raw ?? "").trim().replace(/[\s().-]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  else if (/^0?\d{10}$/.test(s) && defaultCc) s = defaultCc + s.replace(/^0/, "");
  return /^[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** RFC 4180-ish: quoted fields, escaped quotes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

export const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // leading = + - @ would run as a formula in a spreadsheet
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export type ImportOptions = {
  phoneColumn: string;
  nameColumn?: string;
  emailColumn?: string;
  attributeColumns: string[];
  tag?: string;
  /** only when the importer confirms these people gave marketing consent */
  optIn?: { source: string; proof: string };
  userId?: string;
};

export async function importContacts(db: PrismaClient, orgId: string, rows: string[][], o: ImportOptions) {
  const [header, ...data] = rows;
  if (!header) return { created: 0, updated: 0, duplicates: 0, invalid: [] as { line: number; value: string }[] };
  const col = (name?: string) => (name ? header.indexOf(name) : -1);
  const pi = col(o.phoneColumn);
  if (pi < 0) throw new Error(`no column called "${o.phoneColumn}"`);
  const tag = o.tag?.trim() ? await db.tag.upsert({ where: { orgId_name: { orgId, name: o.tag.trim() } }, create: { orgId, name: o.tag.trim() }, update: {} }) : null;
  const seen = new Set<string>();
  const invalid: { line: number; value: string }[] = [];
  let created = 0, updated = 0, duplicates = 0;
  for (const [i, r] of data.entries()) {
    const waId = normalizePhone(r[pi] ?? "");
    if (!waId) { invalid.push({ line: i + 2, value: r[pi] ?? "" }); continue; }
    if (seen.has(waId)) { duplicates++; continue; }
    seen.add(waId);
    const name = col(o.nameColumn) >= 0 ? r[col(o.nameColumn)]?.trim() || null : null;
    const email = col(o.emailColumn) >= 0 ? r[col(o.emailColumn)]?.trim() || null : null;
    const existing = await db.contact.findUnique({ where: { orgId_waId: { orgId, waId } } });
    const c = existing
      ? await db.contact.update({ where: { id: existing.id }, data: { ...(name && !existing.name ? { name } : {}), ...(email && !existing.email ? { email } : {}) } })
      : await db.contact.create({ data: { orgId, waId, name, email } });
    existing ? updated++ : created++;
    for (const key of o.attributeColumns) {
      const v = r[col(key)]?.trim();
      if (v) await db.contactAttribute.upsert({ where: { contactId_key: { contactId: c.id, key } }, create: { contactId: c.id, key, value: v }, update: { value: v } });
    }
    if (tag) await db.contactTag.upsert({ where: { contactId_tagId: { contactId: c.id, tagId: tag.id } }, create: { contactId: c.id, tagId: tag.id }, update: {} });
    // never overwrite an opt-out with an imported opt-in
    if (o.optIn && c.optInStatus !== "opted_out") await applyOptIn(db, { orgId, contactId: c.id, source: o.optIn.source, proof: o.optIn.proof, userId: o.userId });
  }
  return { created, updated, duplicates, invalid };
}

/**
 * Right to erasure: removes the contact, every message to or from them (and stored media), queued sends,
 * campaign records and notes. The audit entry keeps only the internal id, not the phone number.
 */
export async function deleteContactData(db: PrismaClient, orgId: string, contactId: string) {
  const contact = await db.contact.findFirst({ where: { id: contactId, orgId }, include: { conversations: { select: { id: true } } } });
  if (!contact) return null;
  const convIds = contact.conversations.map((c) => c.id);
  const media = await db.message.findMany({ where: { orgId, conversationId: { in: convIds }, mediaPath: { not: null } }, select: { mediaPath: true } });
  const msgs = await db.message.findMany({ where: { orgId, conversationId: { in: convIds } }, select: { wamid: true } });
  const result = await db.$transaction(async (tx) => {
    await tx.messageStatus.deleteMany({ where: { wamid: { in: msgs.map((m) => m.wamid) } } });
    const m = await tx.message.deleteMany({ where: { orgId, conversationId: { in: convIds } } });
    const o = await tx.outboundMessage.deleteMany({ where: { orgId, contactId } });
    await tx.apiEvent.deleteMany({ where: { orgId, contactId } });
    await tx.contact.delete({ where: { id: contactId } }); // cascades conversations, notes, attributes, tags, recipients
    await tx.auditLog.create({ data: { orgId, action: "contact.erase", target: contactId, meta: { messages: m.count, outbound: o.count } } });
    return { messages: m.count, outbound: o.count };
  });
  for (const x of media) if (x.mediaPath) await deleteObject(x.mediaPath).catch(() => {});
  return result;
}

import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

/** The full key is returned once and never stored; only its sha256 and a short prefix are kept. */
export async function createApiKey(db: PrismaClient, orgId: string, name: string, scopes: string[], userId?: string) {
  const key = `ll_live_${randomBytes(24).toString("base64url")}`;
  const row = await db.apiKey.create({ data: { orgId, name, scopes, prefix: key.slice(0, 12), hash: hash(key), createdById: userId } });
  return { key, row };
}

export async function authenticateApiKey(db: PrismaClient, header: string | null) {
  const key = /^Bearer\s+(ll_live_[A-Za-z0-9_-]{20,})$/.exec(header ?? "")?.[1];
  if (!key) return null;
  const row = await db.apiKey.findUnique({ where: { hash: hash(key) } });
  if (!row || row.revokedAt) return null;
  await db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return row;
}

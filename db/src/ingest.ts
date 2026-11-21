import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Store the raw body before acknowledging Meta. A byte-identical redelivery returns the same row.
 * The workspace comes from the entries' WABA ids; unknown or mixed accounts stay unassigned and visible to nobody.
 */
export async function storeWebhook(db: PrismaClient, raw: string) {
  const dedupeKey = createHash("sha256").update(raw).digest("hex");
  let orgId: string | null = null;
  let field: string | null = null;
  try {
    const entries: { id?: unknown; changes?: { field?: unknown }[] }[] = Array.isArray(JSON.parse(raw)?.entry) ? JSON.parse(raw).entry : [];
    field = typeof entries[0]?.changes?.[0]?.field === "string" ? (entries[0].changes[0].field as string) : null;
    // A batch is shown in one workspace's event log only if every entry is that workspace's account.
    const owners = await Promise.all(entries.map(async (e) => e?.id ? (await db.waba.findUnique({ where: { metaWabaId: String(e.id) }, select: { orgId: true } }))?.orgId ?? null : null));
    if (owners.length && owners.every((o) => o && o === owners[0])) orgId = owners[0];
  } catch {
    // not JSON: stored anyway, processing records why it was skipped
  }
  return db.webhookEvent.upsert({
    where: { dedupeKey },
    create: { dedupeKey, rawBody: raw, orgId, field },
    update: {},
    select: { id: true, processedAt: true },
  });
}

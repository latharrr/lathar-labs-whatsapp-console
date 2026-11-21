/**
 * After a restore or a server move: does ENCRYPTION_KEY open every stored secret in DATABASE_URL?
 * Prints counts only, never a secret. Exit 1 if anything fails to decrypt (wrong or lost key).
 * Run: npm run key:check -w db   (or with DATABASE_URL=... pointing at a restored copy)
 */
import { PrismaClient } from "@prisma/client";
import { decrypt } from "./crypto";

const db = new PrismaClient();
async function main() {
  const boxes = [
    ...(await db.waba.findMany({ select: { accessTokenEnc: true } })).map((w) => ["WABA token", w.accessTokenEnc] as const),
    ...(await db.outboundWebhook.findMany({ select: { secretEnc: true } })).map((h) => ["outbound webhook secret", h.secretEnc] as const),
  ];
  const bad: Record<string, number> = {};
  for (const [label, box] of boxes) {
    try { decrypt(box); } catch { bad[label] = (bad[label] ?? 0) + 1; }
  }
  const failed = Object.values(bad).reduce((a, b) => a + b, 0);
  console.log(`${boxes.length - failed} of ${boxes.length} stored secrets decrypt with this ENCRYPTION_KEY.`);
  for (const [label, n] of Object.entries(bad)) console.log(`  ${n} ${label}(s) do not: wrong or lost key, reconnect those accounts`);
  return failed ? 1 : 0;
}
main().then((code) => db.$disconnect().then(() => process.exit(code)), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });

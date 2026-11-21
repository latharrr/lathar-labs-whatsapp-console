import { headers } from "next/headers";
import { prisma, type Prisma } from "@ll/db";
import type { Member } from "./session";

/** Every mutating action writes one row. Never pass tokens or message bodies in meta. */
export async function audit(m: Member, action: string, target?: string, meta?: Prisma.InputJsonObject) {
  const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await prisma.auditLog.create({ data: { orgId: m.orgId, userId: m.userId, action, target, meta, ip } });
}

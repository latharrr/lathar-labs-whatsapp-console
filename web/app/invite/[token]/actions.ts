"use server";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { hashPassword, prisma } from "@ll/db";
import { act, str, type ActionState } from "@/lib/server";

const find = (token: string) => prisma.invite.findFirst({ where: { tokenHash: createHash("sha256").update(token).digest("hex"), acceptedAt: null, expiresAt: { gt: new Date() } }, include: { org: true } });

/** Accept an invite. New people set a password; an existing account must sign in instead (no takeover by link). */
export async function acceptInvite(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const inv = await find(str(f, "token"));
    if (!inv) throw new Error("This invite has expired or was already used. Ask for a new one.");
    const existing = await prisma.user.findUnique({ where: { email: inv.email } });
    if (existing) {
      await prisma.$transaction([
        prisma.membership.upsert({ where: { orgId_userId: { orgId: inv.orgId, userId: existing.id } }, create: { orgId: inv.orgId, userId: existing.id, role: inv.role }, update: {} }),
        prisma.invite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
        prisma.auditLog.create({ data: { orgId: inv.orgId, userId: existing.id, action: "team.join", target: inv.email, meta: { role: inv.role, existingAccount: true } } }),
      ]);
      return;
    }
    const password = str(f, "password");
    if (password.length < 10) throw new Error("Choose a password of at least 10 characters.");
    if (password !== str(f, "confirm")) throw new Error("The passwords do not match.");
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: inv.email, name: str(f, "name") || null, passwordHash: await hashPassword(password) } });
      await tx.membership.create({ data: { orgId: inv.orgId, userId: u.id, role: inv.role } });
      await tx.invite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      await tx.auditLog.create({ data: { orgId: inv.orgId, userId: u.id, action: "team.join", target: inv.email, meta: { role: inv.role } } });
    });
  });
  if (r.error) return r;
  redirect("/login?joined=1");
}

export async function inviteInfo(token: string) {
  const inv = await find(token);
  if (!inv) return null;
  const existing = await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  return { email: inv.email, role: inv.role, org: inv.org.name, existing: !!existing };
}

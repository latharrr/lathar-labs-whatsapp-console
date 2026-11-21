import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma, type Role } from "@ll/db";
import { can, type Action } from "@ll/db/src/permissions";
import { authOptions } from "./auth";

export type Member = { userId: string; email: string; name: string | null; orgId: string; orgName: string; role: Role; orgs: { id: string; name: string }[] };
export const ORG_COOKIE = "ll_org";

/**
 * Role and workspace are read from the database on every request, so a change takes effect immediately.
 * The workspace cookie only chooses among the user's own memberships; it can never grant access.
 */
export async function requireMember(): Promise<Member> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");
  const all = await prisma.membership.findMany({ where: { userId }, include: { org: true, user: true }, orderBy: { org: { createdAt: "asc" } } });
  if (!all.length) redirect("/login?error=NoWorkspace");
  const wanted = cookies().get(ORG_COOKIE)?.value;
  const m = all.find((x) => x.orgId === wanted) ?? all[0];
  return { userId, email: m.user.email, name: m.user.name, orgId: m.orgId, orgName: m.org.name, role: m.role, orgs: all.map((x) => ({ id: x.orgId, name: x.org.name })) };
}

export const canManage = (role: Role) => role === "OWNER" || role === "ADMIN";

export async function requireRole(roles: Role[]): Promise<Member> {
  const m = await requireMember();
  if (!roles.includes(m.role)) throw new Error("You do not have permission to do this.");
  return m;
}

/** Server-side permission check shared with the API (db/src/permissions.ts). */
export async function requireCan(action: Action): Promise<Member> {
  const m = await requireMember();
  if (!can(m.role, action)) throw new Error("You do not have permission to do this.");
  return m;
}

/** For pages: a missing permission shows a clear "no access" page instead of a server error. */
export async function requirePage(action: Action): Promise<Member> {
  const m = await requireMember();
  if (!can(m.role, action)) redirect(`/no-access?need=${encodeURIComponent(action)}`);
  return m;
}

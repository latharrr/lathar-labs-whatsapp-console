"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@ll/db";
import { ORG_COOKIE, requireMember } from "./session";

/** Switch workspace: only to one the signed-in user is a member of. */
export async function switchWorkspace(form: FormData) {
  const m = await requireMember();
  const orgId = String(form.get("orgId") ?? "");
  const ok = await prisma.membership.findFirst({ where: { userId: m.userId, orgId } });
  if (ok) cookies().set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}

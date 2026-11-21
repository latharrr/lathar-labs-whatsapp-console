/** Add a team member: npm run user:create -w db -- someone@example.com ADMIN
 *  Prints a generated password once. Phase 1 has no invite email (that needs a mail service). */
import { randomBytes } from "node:crypto";
import { prisma, hashPassword, Role } from "./index";

async function main() {
  const [email, roleArg = "AGENT"] = process.argv.slice(2);
  const role = roleArg.toUpperCase() as Role;
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email) || !(role in Role)) throw new Error("usage: user:create <email> <OWNER|ADMIN|AGENT|VIEWER>");
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const password = randomBytes(12).toString("base64url");
  const user = await prisma.user.upsert({ where: { email }, create: { email, passwordHash: await hashPassword(password) }, update: {} });
  await prisma.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: user.id } }, create: { orgId: org.id, userId: user.id, role }, update: { role } });
  await prisma.auditLog.create({ data: { orgId: org.id, action: "user.create", target: email, meta: { role, via: "cli" } } });
  console.log(`${email} is ${role} in ${org.name}. Password (shown once): ${password}`);
}
main().finally(() => prisma.$disconnect());

import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { prisma, verifyPassword } from "@ll/db";
import { log } from "@ll/db/src/redact";

export const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// shortcut: in-memory limiter, per process; move to Redis when running more than one web instance.
// Counts failed attempts only; a successful sign-in clears them.
const failures = new Map<string, number[]>();
const recentFailures = (key: string) => (failures.get(key) ?? []).filter((t) => Date.now() - t < 60_000);
const tooMany = (key: string) => recentFailures(key).length >= 5;
const recordFailure = (key: string) => failures.set(key, [...recentFailures(key), Date.now()]);

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(c) {
        const email = String(c?.email ?? "").trim().toLowerCase();
        const password = String(c?.password ?? "");
        if (!email || !password || tooMany(email)) return null;
        try {
          const user = await prisma.user.findUnique({ where: { email } });
          const ok = await verifyPassword(password, user?.passwordHash);
          if (ok) failures.delete(email);
          else recordFailure(email);
          await prisma.auditLog.create({ data: { userId: user?.id, action: ok ? "auth.signin" : "auth.signin_failed", target: email, meta: { provider: "credentials" } } });
          return ok && user ? { id: user.id, email: user.email, name: user.name } : null;
        } catch (e) {
          // the thrown message ends up in the redirect URL, so never pass the database error through
          log.error("sign-in unavailable", e);
          throw new Error("Unavailable");
        }
      },
    }),
    ...(googleEnabled ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! })] : []),
  ],
  callbacks: {
    // Google only signs in people already added to the team; nobody self-registers.
    async signIn({ account, profile, user }) {
      if (account?.provider !== "google") return true;
      const email = (profile?.email ?? user.email ?? "").toLowerCase();
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
      const known = verified && email ? await prisma.user.findUnique({ where: { email } }) : null;
      await prisma.auditLog.create({ data: { userId: known?.id, action: known ? "auth.signin" : "auth.signin_refused", target: email, meta: { provider: "google" } } });
      return known ? true : "/login?error=NotInvited";
    },
    async jwt({ token, user, account }) {
      if (user && account?.provider === "google") {
        token.uid = (await prisma.user.findUnique({ where: { email: user.email!.toLowerCase() } }))?.id;
      } else if (user) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as { id?: string }).id = token.uid as string | undefined;
      return session;
    },
  },
};

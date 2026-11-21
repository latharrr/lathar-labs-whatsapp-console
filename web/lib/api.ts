import { prisma } from "@ll/db";
import { authenticateApiKey } from "@ll/db/src/apikeys";
import { redis } from "@ll/db/src/queue";
import { log } from "@ll/db/src/redact";
import { SendRefused } from "@ll/db/src/send";

export const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (status: number, error: string) => json(status, { error });

const LIMIT = 120; // requests per key per minute

/** API key + scope + rate limit. Fails closed when the limiter is unavailable. */
export async function apiAuth(req: Request, scope: string) {
  const key = await authenticateApiKey(prisma, req.headers.get("authorization"));
  if (!key) return { error: fail(401, "Missing or invalid API key. Send Authorization: Bearer ll_live_...") };
  if (!key.scopes.includes(scope)) return { error: fail(403, `This key does not have the ${scope} scope.`) };
  try {
    const k = `api:${key.id}:${Math.floor(Date.now() / 60_000)}`;
    const n = await redis().incr(k);
    if (n === 1) await redis().expire(k, 120);
    if (n > LIMIT) return { error: fail(429, `Rate limit: ${LIMIT} requests a minute per key.`) };
  } catch (e) {
    log.error("api rate limiter unavailable", e);
    return { error: fail(503, "Temporarily unavailable. Retry shortly.") };
  }
  return { key };
}

export async function body<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}

export async function guard(fn: () => Promise<Response>) {
  try { return await fn(); } catch (e) {
    if (e instanceof SendRefused) return fail(422, e.message);
    log.error("api error", e);
    return fail(500, "Something went wrong. Nothing was sent.");
  }
}

export async function apiAudit(orgId: string, keyId: string, action: string, target?: string, meta?: Record<string, unknown>) {
  await prisma.auditLog.create({ data: { orgId, action, target, meta: { via: "api", keyId, ...meta } } });
}

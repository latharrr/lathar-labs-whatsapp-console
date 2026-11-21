import { prisma } from "@ll/db";
import { handleApiEvent } from "@ll/db/src/automation";
import { apiAudit, apiAuth, body, fail, guard, json } from "@/lib/api";
import { webJobs } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/events — e.g. { "name": "order.placed", "phone": "+91…", "data": { "orderId": "A-77" }, "idempotencyKey": "order-A-77" } */
export async function POST(req: Request) {
  return guard(async () => {
    const a = await apiAuth(req, "events:write");
    if (a.error) return a.error;
    const b = await body<{ name?: string; phone?: string; data?: Record<string, unknown>; idempotencyKey?: string }>(req);
    if (!b?.name || !/^[a-z0-9_.-]{2,60}$/i.test(b.name)) return fail(400, "name: letters, numbers, dots and dashes, like order.placed.");
    if (b.data && (typeof b.data !== "object" || JSON.stringify(b.data).length > 10_000)) return fail(400, "data: an object under 10 KB.");
    const r = await handleApiEvent({ db: prisma, jobs: webJobs }, a.key.orgId, { name: b.name, phone: b.phone, data: b.data ?? {}, idempotencyKey: b.idempotencyKey });
    await apiAudit(a.key.orgId, a.key.id, "api.event", r.eventId, { name: b.name });
    return json(202, r);
  });
}

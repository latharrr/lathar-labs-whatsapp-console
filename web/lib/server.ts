import { Prisma } from "@ll/db";
import { SendRefused } from "@ll/db/src/send";
import { bullJobs } from "@ll/db/src/queue";
import { log, redact } from "@ll/db/src/redact";
import type { Jobs } from "@ll/db/src/jobs";

export type ActionState = { ok?: string; error?: string; data?: Record<string, unknown> };

/**
 * Jobs from the web app. If Redis is down the row is already saved as queued, and the worker's sweeper
 * picks it up within two minutes, so a queue error must not fail the user's action.
 */
export const webJobs: Jobs = Object.fromEntries(
  Object.entries(bullJobs).map(([k, fn]) => [k, async (...a: unknown[]) => {
    try { await (fn as (...x: unknown[]) => Promise<void>)(...a); } catch (e) { log.error(`queue ${k} failed (the sweeper will retry)`, e); }
  }]),
) as unknown as Jobs;

/** Turn thrown errors into a message the form can show. Unknown errors are logged, not leaked. */
export async function act(fn: () => Promise<ActionState | string | void>): Promise<ActionState> {
  try {
    const r = await fn();
    return typeof r === "string" ? { ok: r } : r ?? { ok: "Saved." };
  } catch (e) {
    if (e instanceof SendRefused) return { error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "That already exists." };
    if (e instanceof Error && (e.message.startsWith("NEXT_REDIRECT") || e.message === "NEXT_NOT_FOUND")) throw e;
    const prismaError = [Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError, Prisma.PrismaClientValidationError, Prisma.PrismaClientInitializationError, Prisma.PrismaClientRustPanicError].some((C) => e instanceof C);
    if (e instanceof Error && !prismaError) return { error: redact(e.message) };
    log.error("action failed", e);
    return { error: "Something went wrong. Nothing was changed." };
  }
}

export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

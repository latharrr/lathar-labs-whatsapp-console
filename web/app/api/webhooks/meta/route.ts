/**
 * Meta webhook endpoint. GET = one-time verification handshake; POST = signed events.
 * POST stores the raw body first (durable), enqueues, and answers 200 fast; the worker does the rest.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma, verifySignature } from "@ll/db";
import { storeWebhook } from "@ll/db/src/ingest";
import { enqueueWebhookEvent } from "@ll/db/src/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4 * 1024 * 1024; // Meta batches up to 1000 updates, payloads up to 3 MB

function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const expected = process.env.META_VERIFY_TOKEN ?? "";
  if (expected && q.get("hub.mode") === "subscribe" && same(q.get("hub.verify_token") ?? "", expected)) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
  const raw = Buffer.from(await req.arrayBuffer()); // verify the exact bytes Meta signed
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET ?? "")) {
    console.warn("meta webhook: bad signature");
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const ev = await storeWebhook(prisma, raw.toString("utf8"));
  if (!ev.processedAt) {
    // Redis down is not data loss: the row exists and the worker's sweeper re-queues it.
    await enqueueWebhookEvent(ev.id).catch((e) => console.warn(`meta webhook: enqueue failed, sweeper will retry: ${e.message}`));
  }
  return NextResponse.json({ ok: true });
}

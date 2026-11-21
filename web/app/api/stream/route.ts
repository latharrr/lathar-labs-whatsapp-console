import IORedis from "ioredis";
import { requireMember } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSE: one Redis subscription per open tab, on this workspace's channel only. */
export async function GET(req: Request) {
  const m = await requireMember();
  const sub = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { maxRetriesPerRequest: 3, lazyConnect: true });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch {} };
      try {
        await sub.connect();
        await sub.subscribe(`rt:${m.orgId}`);
      } catch {
        controller.close();
        return;
      }
      sub.on("message", (_c, msg) => send(`data: ${msg}\n\n`));
      send(": connected\n\n");
      const ping = setInterval(() => send(": ping\n\n"), 25_000);
      req.signal.addEventListener("abort", () => { clearInterval(ping); sub.quit().catch(() => {}); try { controller.close(); } catch {} });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

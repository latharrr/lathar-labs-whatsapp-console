import { prisma } from "@ll/db";
import { getObject } from "@ll/db/src/storage";
import { requireMember } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Media is served only to members of the workspace that owns the message. */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const m = await requireMember();
  const msg = await prisma.message.findFirst({ where: { id: params.id, orgId: m.orgId }, select: { mediaPath: true, mediaMime: true, mediaName: true } });
  if (!msg?.mediaPath) return new Response("Not found", { status: 404 });
  const bytes = await getObject(msg.mediaPath).catch(() => null);
  if (!bytes) return new Response("Not found", { status: 404 });
  const mime = msg.mediaMime ?? "application/octet-stream";
  const inline = /^(image|audio|video)\//.test(mime) && mime !== "image/svg+xml";
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": inline ? mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${(msg.mediaName ?? "file").replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

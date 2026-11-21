import { prisma } from "@ll/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tracked link from a campaign's URL button: count the click, then send the person on. */
export async function GET(_: Request, { params }: { params: { code: string } }) {
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(params.code)) return new Response("Not found", { status: 404 });
  const link = await prisma.trackedLink.findUnique({ where: { code: params.code } });
  if (!link || !/^https?:\/\//.test(link.url)) return new Response("This link has expired.", { status: 404 });
  await prisma.trackedLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 }, lastClickAt: new Date() } });
  if (link.recipientId) await prisma.campaignRecipient.updateMany({ where: { id: link.recipientId, clickedAt: null }, data: { clickedAt: new Date() } });
  return Response.redirect(link.url, 302);
}

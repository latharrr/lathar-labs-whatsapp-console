import { prisma, type Prisma } from "@ll/db";
import type { Member } from "./session";

export type InboxFilters = { view?: string; tag?: string; number?: string; q?: string };
export const VIEWS = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "unassigned", label: "Unassigned" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
] as const;

export function inboxWhere(m: Member, f: InboxFilters): Prisma.ConversationWhereInput {
  const view = f.view ?? "open";
  const q = f.q?.trim();
  return {
    orgId: m.orgId,
    ...(view === "open" ? { status: "open" } : view === "closed" ? { status: "closed" } : {}),
    ...(view === "mine" ? { assigneeId: m.userId, status: "open" } : view === "unassigned" ? { assigneeId: null, status: "open" } : {}),
    ...(f.number ? { phoneNumberId: f.number } : {}),
    ...(f.tag ? { contact: { tags: { some: { tag: { name: f.tag } } } } } : {}),
    ...(q ? { OR: [{ contact: { name: { contains: q, mode: "insensitive" } } }, { contact: { profileName: { contains: q, mode: "insensitive" } } }, { contact: { waId: { contains: q.replace(/\D/g, "") || q } } }, { lastMessagePreview: { contains: q, mode: "insensitive" } }] } : {}),
  };
}

export async function listConversations(m: Member, f: InboxFilters) {
  const [rows, tags, numbers, counts] = await Promise.all([
    prisma.conversation.findMany({
      where: inboxWhere(m, f), orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }], take: 100,
      include: { contact: { select: { name: true, profileName: true, waId: true, isFixture: true, optInStatus: true } }, assignee: { select: { name: true, email: true } }, phoneNumber: { select: { displayPhoneNumber: true, isFixture: true } } },
    }),
    prisma.tag.findMany({ where: { orgId: m.orgId }, orderBy: { name: "asc" } }),
    prisma.phoneNumber.findMany({ where: { waba: { orgId: m.orgId } }, select: { id: true, displayPhoneNumber: true, isFixture: true } }),
    prisma.conversation.groupBy({ by: ["status"], where: { orgId: m.orgId }, _count: { _all: true } }),
  ]);
  return { rows, tags, numbers, open: counts.find((c) => c.status === "open")?._count._all ?? 0 };
}

export async function getThread(m: Member, id: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id, orgId: m.orgId },
    include: {
      contact: { include: { attributes: { orderBy: { key: "asc" } }, tags: { include: { tag: true } }, recipients: { include: { campaign: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" }, take: 5 } } },
      phoneNumber: { include: { waba: { select: { id: true, isFixture: true, name: true } } } },
      assignee: { select: { id: true, name: true, email: true } },
      notes: { include: { author: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!conv) return null;
  const [messages, members, templates, quickReplies, events, queued] = await Promise.all([
    prisma.message.findMany({ where: { orgId: m.orgId, conversationId: id }, orderBy: { timestamp: "asc" }, take: 300 }),
    prisma.membership.findMany({ where: { orgId: m.orgId, role: { in: ["OWNER", "ADMIN", "AGENT"] } }, include: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.template.findMany({ where: { wabaId: conv.phoneNumber.wabaId, status: "APPROVED" }, orderBy: { name: "asc" } }),
    prisma.quickReply.findMany({ where: { orgId: m.orgId }, orderBy: { shortcut: "asc" } }),
    prisma.apiEvent.findMany({ where: { orgId: m.orgId, contactId: conv.contactId }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.outboundMessage.findMany({ where: { orgId: m.orgId, conversationId: id, status: { in: ["queued", "sending", "failed", "blocked", "unknown"] }, kind: { not: "read" } }, orderBy: { createdAt: "asc" }, take: 20 }),
  ]);
  return { conv, messages, members, templates, quickReplies, events, queued };
}

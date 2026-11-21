"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, type Prisma } from "@ll/db";
import { launchCampaign, retryFailed as retry, setCampaignState, type Variant } from "@ll/db/src/campaigns";
import { slots } from "@ll/db/src/templates";
import { audit } from "@/lib/audit";
import { requireCan } from "@/lib/session";
import { act, str, webJobs, type ActionState } from "@/lib/server";

type Input = { name: string; phoneNumberId: string; segmentId: string; variants: Variant[]; scheduledAt: string; throttlePerMinute: number; utm: Record<string, string> };

export async function createCampaign(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const m = await requireCan("campaigns.write");
    let i: Input;
    try { i = JSON.parse(str(f, "campaign")); } catch { throw new Error("The campaign form could not be read."); }
    if (!i.name?.trim()) throw new Error("Name the campaign.");
    const phone = await prisma.phoneNumber.findFirst({ where: { id: i.phoneNumberId, waba: { orgId: m.orgId } } });
    if (!phone) throw new Error("Pick a number.");
    if (i.segmentId && !(await prisma.segment.findFirst({ where: { id: i.segmentId, orgId: m.orgId } }))) throw new Error("Segment not found.");
    if (!i.variants?.length || i.variants.length > 2) throw new Error("Pick one template, or two for an A/B test.");
    for (const v of i.variants) {
      const t = await prisma.template.findFirst({ where: { id: v.templateId, wabaId: phone.wabaId, status: "APPROVED" } });
      if (!t) throw new Error("Each template must be approved and belong to this number's account.");
      const missing = slots(t.components).filter((s) => !v.variables?.[s]);
      if (missing.length) throw new Error(`Map every variable of ${t.name}: ${missing.join(", ")}.`);
      if (Object.values(v.variables).some((s) => s.startsWith("link:") && !/^link:https:\/\//.test(s))) throw new Error("Tracked links need an https:// address.");
    }
    const throttle = Math.round(Number(i.throttlePerMinute));
    if (!(throttle >= 1 && throttle <= 1000)) throw new Error("Throttle: 1 to 1000 messages a minute.");
    const scheduledAt = i.scheduledAt ? new Date(i.scheduledAt) : null;
    if (scheduledAt && (isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60_000)) throw new Error("The scheduled time is in the past.");
    const c = await prisma.campaign.create({
      data: { orgId: m.orgId, phoneNumberId: phone.id, segmentId: i.segmentId || null, name: i.name.trim().slice(0, 120), variants: i.variants as unknown as Prisma.InputJsonArray, throttlePerMinute: throttle, scheduledAt, utm: i.utm ?? {}, createdById: m.userId },
    });
    await audit(m, "campaign.create", c.id, { name: c.name });
    return { data: { id: c.id } };
  });
  if (r.error) return r;
  redirect(`/campaigns/${r.data!.id}`);
}

const refresh = (id: string) => { revalidatePath("/campaigns"); revalidatePath(`/campaigns/${id}`); };

export async function launch(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("campaigns.send");
    const pre = await launchCampaign(prisma, m.orgId, str(f, "id"), m.userId);
    refresh(str(f, "id"));
    return `Launched to ${pre.eligible} opted-in contacts.${pre.isTest ? " Test account: nothing is sent to WhatsApp." : ""}`;
  });
}

export async function changeState(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("campaigns.send");
    const action = str(f, "action") as "pause" | "resume" | "cancel";
    if (!["pause", "resume", "cancel"].includes(action)) throw new Error("Unknown action.");
    await setCampaignState(prisma, webJobs, m.orgId, str(f, "id"), action, m.userId);
    refresh(str(f, "id"));
    return { pause: "Paused. Queued messages wait until you resume.", resume: "Resumed.", cancel: "Cancelled. Nothing more will be sent." }[action];
  });
}

export async function retryFailed(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("campaigns.send");
    const r = await retry(prisma, m.orgId, str(f, "id"), m.userId);
    refresh(str(f, "id"));
    return `Retrying ${r.retried}. ${r.notRetryable} failed for reasons a retry will not fix.`;
  });
}

export async function deleteDraftCampaign(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const m = await requireCan("campaigns.write");
    const d = await prisma.campaign.deleteMany({ where: { id: str(f, "id"), orgId: m.orgId, status: "draft" } });
    if (!d.count) throw new Error("Only drafts can be deleted. Cancel a running campaign instead.");
    await audit(m, "campaign.delete_draft", str(f, "id"));
  });
  if (r.error) return r;
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

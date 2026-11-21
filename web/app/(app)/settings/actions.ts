"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, encrypt, decrypt, Prisma, type Waba } from "@ll/db";
import { createHash, randomBytes } from "node:crypto";
import { graphPost } from "@/lib/graph";
import { requireCan } from "@/lib/session";
import { act, str, type ActionState } from "@/lib/server";
import { resumableUpload } from "@ll/db/src/graph";

import { requireRole } from "@/lib/session";
import { audit } from "@/lib/audit";
import { graphGet, GraphError, inspectToken, listPhoneNumbers } from "@/lib/graph";

export type FormState = { ok?: string; error?: string };

const REQUIRED_SCOPES = ["whatsapp_business_management", "whatsapp_business_messaging"];

const explain = (e: unknown) =>
  e instanceof GraphError
    ? e.code === 190 ? "Meta rejected the token (expired or revoked)."
    : e.code === 100 ? "Meta did not recognise that WABA ID for this token."
    : e.code === 200 || e.status === 403 ? "This token has no access to that WABA. Add the WABA to the System User's assets."
    : `Meta error ${e.code || e.status}: ${e.message}`
    : e instanceof Error ? e.message : "Unexpected error";

/** Read-only against Meta: only GET calls. It never touches webhooks or app subscriptions. */
async function syncFromMeta(waba: Waba, token: string) {
  const info = await inspectToken(token);
  const phones = await listPhoneNumbers(waba.metaWabaId, token);
  for (const p of phones) {
    const data = {
      displayPhoneNumber: p.display_phone_number, verifiedName: p.verified_name ?? null, status: p.status ?? null,
      nameStatus: p.name_status ?? null, qualityRating: p.quality_rating ?? null, throughputLevel: p.throughput?.level ?? null,
      messagingLimit: p.whatsapp_business_manager_messaging_limit ?? p.messaging_limit_tier ?? null, syncedAt: new Date(),
    };
    await prisma.phoneNumber.upsert({ where: { metaPhoneNumberId: p.id }, create: { wabaId: waba.id, metaPhoneNumberId: p.id, ...data }, update: data });
  }
  await prisma.waba.update({
    where: { id: waba.id },
    data: { tokenValid: info ? info.valid : true, tokenExpiresAt: info?.expiresAt ?? null, tokenCheckedAt: new Date() },
  });
  return { phones: phones.length, info };
}

const ConnectInput = z.object({
  wabaId: z.string().trim().regex(/^\d{5,25}$/, "WABA ID is the numeric ID from WhatsApp Manager."),
  token: z.string().trim().min(20, "Paste the full System User access token."),
});

export async function connectWaba(_: FormState, form: FormData): Promise<FormState> {
  try {
    const m = await requireRole(["OWNER", "ADMIN"]);
    const parsed = ConnectInput.safeParse({ wabaId: form.get("wabaId"), token: form.get("token") });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { wabaId, token } = parsed.data;

    const existing = await prisma.waba.findUnique({ where: { metaWabaId: wabaId } });
    if (existing && existing.orgId !== m.orgId) return { error: "That WABA is connected to another workspace." };

    const info = await inspectToken(token);
    if (info && !info.valid) return { error: "Meta says this token is not valid." };
    const missing = info ? REQUIRED_SCOPES.filter((s) => !info.scopes.includes(s)) : [];
    if (missing.length) return { error: `The token is missing permissions: ${missing.join(", ")}.` };

    const meta = await graphGet<{ id: string; name?: string }>(wabaId, token, { fields: "id,name" });
    const waba = await prisma.waba.upsert({
      where: { metaWabaId: wabaId },
      create: { orgId: m.orgId, metaWabaId: wabaId, name: meta.name ?? null, accessTokenEnc: encrypt(token) },
      update: { name: meta.name ?? null, accessTokenEnc: encrypt(token) },
    });
    const r = await syncFromMeta(waba, token);
    await audit(m, existing ? "waba.token_replaced" : "waba.connect", wabaId, { phones: r.phones, tokenChecked: !!r.info });
    revalidatePath("/");
    revalidatePath("/settings");
    return { ok: `Connected ${meta.name ?? wabaId}: ${r.phones} number${r.phones === 1 ? "" : "s"} synced.${r.info ? "" : " Set META_APP_ID to also check token expiry."}` };
  } catch (e) {
    return { error: explain(e) };
  }
}

export async function syncWaba(_: FormState, form: FormData): Promise<FormState> {
  try {
    const m = await requireRole(["OWNER", "ADMIN"]);
    const waba = await prisma.waba.findFirst({ where: { id: String(form.get("id")), orgId: m.orgId } });
    if (!waba) return { error: "Account not found." };
    if (waba.isFixture) return { error: "Fixture accounts are test data and cannot sync with Meta." };
    const r = await syncFromMeta(waba, decrypt(waba.accessTokenEnc));
    await audit(m, "waba.sync", waba.metaWabaId, { phones: r.phones });
    revalidatePath("/");
    revalidatePath("/settings");
    return { ok: `Synced ${r.phones} number${r.phones === 1 ? "" : "s"}.` };
  } catch (e) {
    if (e instanceof GraphError && e.code === 190) {
      const m = await requireRole(["OWNER", "ADMIN"]);
      await prisma.waba.updateMany({ where: { id: String(form.get("id")), orgId: m.orgId }, data: { tokenValid: false, tokenCheckedAt: new Date() } });
    }
    return { error: explain(e) };
  }
}

// ---- Phases 2-4 settings ----

const PROFILE_LIMITS = { about: 139, description: 512, address: 256, email: 128 } as const;

export async function saveProfile(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("settings.manage");
    const phone = await prisma.phoneNumber.findFirst({ where: { id: str(f, "phoneId"), waba: { orgId: m.orgId } }, include: { waba: true } });
    if (!phone) throw new Error("Number not found.");
    if (phone.isFixture || phone.waba.isFixture) throw new Error("This is a test account, not connected to Meta, so its profile cannot be changed.");
    const body: Record<string, unknown> = { messaging_product: "whatsapp" };
    for (const [k, max] of Object.entries(PROFILE_LIMITS)) {
      const v = str(f, k);
      if (v.length > max) throw new Error(`${k}: at most ${max} characters.`);
      body[k] = v;
    }
    const websites = str(f, "websites").split(/\s+/).filter(Boolean);
    if (websites.length > 2 || websites.some((w) => !/^https?:\/\//.test(w) || w.length > 256)) throw new Error("Websites: up to two, each starting with http:// or https://.");
    body.websites = websites;
    if (str(f, "vertical")) body.vertical = str(f, "vertical");
    const token = decrypt(phone.waba.accessTokenEnc);
    const photo = f.get("photo");
    try {
      if (photo instanceof File && photo.size) {
        if (!["image/jpeg", "image/png"].includes(photo.type) || photo.size > 5e6) throw new Error("Profile photo: JPEG or PNG, up to 5 MB.");
        body.profile_picture_handle = await resumableUpload(token, new Uint8Array(await photo.arrayBuffer()), photo.type, photo.name);
      }
      await graphPost(`${phone.metaPhoneNumberId}/whatsapp_business_profile`, token, body);
    } catch (e) {
      throw e instanceof GraphError ? new Error(`Meta: ${e.message}`) : e;
    }
    await audit(m, "profile.update", phone.metaPhoneNumberId, { photo: !!body.profile_picture_handle });
    revalidatePath("/settings/profile");
    return "Business profile updated at Meta.";
  });
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function saveMessaging(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("settings.manage");
    const tz = str(f, "timezone") || "Asia/Kolkata";
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { throw new Error("Unknown timezone."); }
    const hours: Record<string, [string, string][]> = {};
    for (const d of DAYS) {
      if (f.get(`${d}:open`) !== "on") continue;
      const a = str(f, `${d}:from`), b = str(f, `${d}:to`);
      if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b) || a >= b) throw new Error(`${d}: opening time must be before closing time.`);
      hours[d] = [[a, b]];
    }
    const words = (k: string) => str(f, k).split(",").map((w) => w.trim().toUpperCase()).filter(Boolean).slice(0, 30);
    const optOut = words("optOut");
    if (!optOut.includes("STOP")) throw new Error("Keep STOP in the opt-out words.");
    const optIn = words("optIn");
    if (optIn.some((w) => optOut.includes(w))) throw new Error("A word cannot be both an opt-in and an opt-out word.");
    await prisma.organization.update({ where: { id: m.orgId }, data: { timezone: tz, businessHours: f.get("hoursOn") === "on" ? hours : Prisma.DbNull, optOutKeywords: optOut, optInKeywords: optIn, optOutReply: str(f, "optOutReply").slice(0, 1000) || null } });
    await audit(m, "settings.messaging", undefined, { optOut, optIn, hours: f.get("hoursOn") === "on" });
    revalidatePath("/settings/messaging");
    return "Saved.";
  });
}

export async function saveQuickReply(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("settings.manage");
    const shortcut = str(f, "shortcut").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30);
    if (!shortcut || !str(f, "body")) throw new Error("Give a shortcut and the text.");
    await prisma.quickReply.upsert({ where: { orgId_shortcut: { orgId: m.orgId, shortcut } }, create: { orgId: m.orgId, shortcut, title: str(f, "title") || shortcut, body: str(f, "body").slice(0, 4096) }, update: { title: str(f, "title") || shortcut, body: str(f, "body").slice(0, 4096) } });
    await audit(m, "quickreply.save", shortcut);
    revalidatePath("/settings/messaging");
    return `Saved /${shortcut}.`;
  });
}

export async function deleteQuickReply(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("settings.manage");
    await prisma.quickReply.deleteMany({ where: { id: str(f, "id"), orgId: m.orgId } });
    await audit(m, "quickreply.delete", str(f, "id"));
    revalidatePath("/settings/messaging");
    return "Deleted.";
  });
}

export async function saveRetention(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("settings.manage");
    const msg = str(f, "messages") ? Number(str(f, "messages")) : null;
    const ev = Number(str(f, "events"));
    if (msg !== null && !(msg >= 30 && msg <= 3650)) throw new Error("Messages: keep for 30 to 3650 days, or leave empty to keep everything.");
    if (!(ev >= 7 && ev <= 365)) throw new Error("Webhook events: 7 to 365 days.");
    await prisma.organization.update({ where: { id: m.orgId }, data: { messageRetentionDays: msg, eventRetentionDays: ev } });
    await audit(m, "settings.retention", undefined, { messages: msg, events: ev });
    revalidatePath("/settings/data");
    return "Saved. The worker applies it once a day.";
  });
}

const ROLES = ["OWNER", "ADMIN", "AGENT", "VIEWER"] as const;

export async function inviteMember(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("team.manage");
    const email = str(f, "email").toLowerCase();
    const role = str(f, "role") as (typeof ROLES)[number];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter an email address.");
    if (!ROLES.includes(role)) throw new Error("Pick a role.");
    if (role === "OWNER" && m.role !== "OWNER") throw new Error("Only an Owner can invite another Owner.");
    if (await prisma.membership.findFirst({ where: { orgId: m.orgId, user: { email } } })) throw new Error("That person is already in this workspace.");
    const token = randomBytes(32).toString("base64url");
    await prisma.invite.create({ data: { orgId: m.orgId, email, role, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 7 * 86_400_000), createdById: m.userId } });
    await audit(m, "team.invite", email, { role });
    revalidatePath("/settings/team");
    const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3100").replace(/\/$/, "");
    return { ok: "Invite created. Send the link yourself; it works once and expires in 7 days.", data: { key: `${base}/invite/${token}` } };
  });
}

export async function revokeInvite(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("team.manage");
    await prisma.invite.deleteMany({ where: { id: str(f, "id"), orgId: m.orgId, acceptedAt: null } });
    await audit(m, "team.invite_revoke", str(f, "id"));
    revalidatePath("/settings/team");
    return "Invite revoked.";
  });
}

async function guardOwners(orgId: string, actorRole: string, target: { role: string; userId: string }, next?: string) {
  if ((target.role === "OWNER" || next === "OWNER") && actorRole !== "OWNER") throw new Error("Only an Owner can change Owners.");
  if (target.role === "OWNER" && next !== "OWNER" && (await prisma.membership.count({ where: { orgId, role: "OWNER" } })) <= 1) throw new Error("A workspace needs at least one Owner.");
}

export async function changeRole(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("team.manage");
    const target = await prisma.membership.findFirst({ where: { id: str(f, "id"), orgId: m.orgId } });
    const role = str(f, "role") as (typeof ROLES)[number];
    if (!target || !ROLES.includes(role)) throw new Error("Member not found.");
    await guardOwners(m.orgId, m.role, target, role);
    await prisma.membership.update({ where: { id: target.id }, data: { role } });
    await audit(m, "team.role", target.userId, { from: target.role, to: role });
    revalidatePath("/settings/team");
    return "Role changed. It applies on their next page load.";
  });
}

export async function removeMember(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("team.manage");
    const target = await prisma.membership.findFirst({ where: { id: str(f, "id"), orgId: m.orgId } });
    if (!target) throw new Error("Member not found.");
    await guardOwners(m.orgId, m.role, target);
    await prisma.$transaction([
      prisma.conversation.updateMany({ where: { orgId: m.orgId, assigneeId: target.userId }, data: { assigneeId: null } }),
      prisma.membership.delete({ where: { id: target.id } }),
    ]);
    await audit(m, "team.remove", target.userId, { role: target.role });
    revalidatePath("/settings/team");
    return "Removed. Their conversations are unassigned.";
  });
}

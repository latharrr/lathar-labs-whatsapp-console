import type { PrismaClient } from "@prisma/client";
import { decrypt } from "./crypto";
import { downloadMedia, GraphError } from "./graph";
import { redact } from "./redact";
import { putObject, storageStatus } from "./storage";

/** Inbound media: Meta's URL expires, so the worker copies the file into our storage right away. */
export async function fetchInboundMedia(db: PrismaClient, messageId: string): Promise<"stored" | "unavailable" | "failed" | "skipped"> {
  const m = await db.message.findUnique({ where: { id: messageId }, include: { phoneNumber: { include: { waba: true } } } });
  if (!m || !m.mediaId || m.mediaStatus === "stored") return "skipped";
  if (m.phoneNumber.isFixture || m.phoneNumber.waba.isFixture) {
    await db.message.update({ where: { id: m.id }, data: { mediaStatus: "unavailable", errorTitle: "Test account: there is no file at Meta to download." } });
    return "unavailable";
  }
  const s = storageStatus();
  if (!s.ready) {
    await db.message.update({ where: { id: m.id }, data: { mediaStatus: "failed", errorTitle: `Media storage is not configured. ${s.detail}` } });
    return "failed";
  }
  try {
    const { bytes, mime } = await downloadMedia(m.mediaId, decrypt(m.phoneNumber.waba.accessTokenEnc));
    const stored = await putObject(`${m.orgId}/in/${m.id}`, bytes, mime);
    await db.message.update({ where: { id: m.id }, data: { mediaStatus: "stored", mediaPath: stored.key, mediaMime: mime, mediaSize: stored.size } });
    return "stored";
  } catch (e) {
    // retryable network or 5xx errors are thrown back so the job retries; final errors are recorded
    if (e instanceof GraphError && (e.status === 0 || e.status >= 500 || e.status === 429)) throw e;
    await db.message.update({ where: { id: m.id }, data: { mediaStatus: "failed", errorTitle: redact(e).slice(0, 200) } });
    return "failed";
  }
}

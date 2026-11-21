import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta signs the exact raw request bytes with the app secret (X-Hub-Signature-256). */
export function sign(raw: string | Buffer, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
}

export function verifySignature(raw: string | Buffer, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const a = Buffer.from(sign(raw, secret));
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

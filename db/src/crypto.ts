import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const k = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64");
  return k;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(box: string): string {
  const [v, iv, tag, ct] = box.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, n: number) => Promise<Buffer>;

const DUMMY_SALT = randomBytes(16);

export async function hashPassword(pw: string): Promise<string> {
  if (pw.length < 10) throw new Error("password must be at least 10 characters");
  const salt = randomBytes(16);
  return `scrypt.${salt.toString("base64url")}.${(await scrypt(pw, salt, 64)).toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const [alg, salt, hash] = (stored ?? "").split(".");
  if (alg !== "scrypt" || !salt || !hash) {
    await scrypt(pw, DUMMY_SALT, 64); // same work as a real check, so timing does not reveal unknown emails
    return false;
  }
  const got = await scrypt(pw, Buffer.from(salt, "base64url"), 64);
  const want = Buffer.from(hash, "base64url");
  return got.length === want.length && timingSafeEqual(got, want);
}

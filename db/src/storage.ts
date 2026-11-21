/**
 * Media storage. "local" (default) writes under MEDIA_DIR, outside the repo. "supabase" uses Supabase Storage's
 * REST API with a service-role key (server only). Keys are always `${orgId}/...`, so a key names its workspace.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export type Stored = { key: string; size: number; mime: string };

export function storageStatus(): { driver: string; ready: boolean; detail: string } {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "supabase") {
    const ok = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_BUCKET);
    return { driver, ready: ok, detail: ok ? `Supabase bucket ${process.env.SUPABASE_BUCKET}` : "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_BUCKET." };
  }
  return { driver: "local", ready: true, detail: `Local disk at ${mediaDir()}` };
}

export const mediaDir = () => resolve(process.env.MEDIA_DIR ?? join(process.cwd(), "..", ".data", "media"));

function localPath(key: string) {
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9._/-]+$/.test(key) || key.includes("..")) throw new Error("bad storage key");
  const root = mediaDir();
  const p = resolve(root, key);
  if (!p.startsWith(root + sep)) throw new Error("bad storage key");
  return p;
}

function supa(path: string) {
  return `${process.env.SUPABASE_URL!.replace(/\/$/, "")}/storage/v1/object/${process.env.SUPABASE_BUCKET}/${path}`;
}
const supaHeaders = () => ({ Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY! });

export async function putObject(key: string, bytes: Uint8Array, mime: string): Promise<Stored> {
  const s = storageStatus();
  if (!s.ready) throw new Error(`Media storage is not configured: ${s.detail}`);
  if (s.driver === "supabase") {
    const res = await fetch(supa(key), { method: "POST", headers: { ...supaHeaders(), "Content-Type": mime, "x-upsert": "true" }, body: bytes as BodyInit });
    if (!res.ok) throw new Error(`Supabase Storage refused the upload: HTTP ${res.status}`);
  } else {
    const p = localPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }
  return { key, size: bytes.byteLength, mime };
}

export async function getObject(key: string): Promise<Uint8Array> {
  if (storageStatus().driver === "supabase") {
    const res = await fetch(supa(key), { headers: supaHeaders() });
    if (!res.ok) throw new Error(`Supabase Storage: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return new Uint8Array(await readFile(localPath(key)));
}

export async function deleteObject(key: string) {
  if (storageStatus().driver === "supabase") {
    await fetch(supa(key), { method: "DELETE", headers: supaHeaders() });
    return;
  }
  await rm(localPath(key), { force: true });
}

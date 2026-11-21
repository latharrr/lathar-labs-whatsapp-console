/**
 * Outbound HTTP to user-supplied URLs (outbound webhooks, flow webhook nodes). Blocks private, loopback,
 * link-local, CGNAT, multicast and metadata addresses. The check runs inside the socket's DNS lookup, so a
 * name that resolves to a public address at validation time cannot rebind to an internal one at connect time.
 * No redirects are followed. Responses are capped.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

function v4Private(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return v4Private(ip);
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return v4Private(mapped[1]);
  return s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb") || s.startsWith("ff") || s.startsWith("64:ff9b");
}

export class BlockedUrlError extends Error {}

const allowPrivate = () => process.env.OUTBOUND_ALLOW_PRIVATE === "1"; // local development only (e.g. n8n on localhost)

/** Static checks before any network: scheme, credentials in URL, literal IPs, obvious internal names. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new BlockedUrlError("That is not a valid URL."); }
  const insecureOk = process.env.NODE_ENV !== "production" || allowPrivate();
  if (u.protocol !== "https:" && !(u.protocol === "http:" && insecureOk)) throw new BlockedUrlError("Use an https:// URL.");
  if (u.username || u.password) throw new BlockedUrlError("Do not put credentials in the URL; use the signing secret.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate()) {
    if (isIP(host) && isPrivateAddress(host)) throw new BlockedUrlError("That address is on a private or internal network.");
    if (/^(localhost|.*\.localhost|.*\.internal|.*\.local|metadata\.google\.internal)$/i.test(host)) throw new BlockedUrlError("That host is internal.");
  }
  return u;
}

function guardedLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad && !allowPrivate()) return cb(Object.assign(new BlockedUrlError(`${hostname} resolves to an internal address`), { code: "EBLOCKED" }), "");
    const wantsAll = (options as { all?: boolean }).all;
    if (wantsAll) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

export type SafeResponse = { status: number; body: string };

export function safeRequest(raw: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number } = {}): Promise<SafeResponse> {
  const u = checkUrl(raw);
  const mod = u.protocol === "https:" ? https : http;
  const maxBytes = init.maxBytes ?? 64 * 1024;
  return new Promise((resolve, reject) => {
    const req = mod.request(u, {
      method: init.method ?? "POST",
      headers: { "User-Agent": "LatharLabs-Dashboard/1.0", ...init.headers, ...(init.body ? { "Content-Length": Buffer.byteLength(init.body).toString() } : {}) },
      lookup: guardedLookup as never,
      timeout: init.timeoutMs ?? 10_000,
    }, (res) => {
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

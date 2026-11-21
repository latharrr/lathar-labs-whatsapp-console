/**
 * Graph API client shared by web and worker. Reads retry 429/5xx/throttle codes with backoff.
 * Writes (sends, uploads, submissions) never retry here: the caller decides, because a retry of a send
 * whose outcome is unknown could deliver a duplicate.
 */
const base = () => (process.env.GRAPH_BASE ?? "https://graph.facebook.com").replace(/\/$/, "");
const version = () => process.env.GRAPH_API_VERSION ?? "v26.0";

export class GraphError extends Error {
  constructor(
    public status: number,
    public code: number,
    message: string,
    /** true when we cannot tell whether Meta acted on the request (timeout or dropped connection after sending) */
    public ambiguous = false,
    public subcode?: number,
  ) {
    super(message);
  }
}

export const THROTTLE_CODES = new Set([4, 17, 32, 613, 80007, 130429, 131056]);
/** Meta codes worth retrying later (temporary). Everything else is final. */
export const RETRYABLE_CODES = new Set([...THROTTLE_CODES, 1, 2, 131000, 131016, 133004]);

export const isRetryable = (e: GraphError) =>
  !e.ambiguous && (e.status === 0 || e.status === 429 || e.status >= 500 || RETRYABLE_CODES.has(e.code));

const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

function networkError(e: unknown): GraphError {
  const code = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code ?? "";
  // Refused or unresolved: the request never left, so a retry cannot duplicate it.
  if (NOT_SENT.has(code)) return new GraphError(0, 0, `could not reach Meta (${code})`);
  return new GraphError(0, 0, "no response from Meta (timeout or dropped connection)", true);
}

type Body = { error?: { code?: number; message?: string; error_subcode?: number; error_data?: { details?: string } } };

async function call<T>(method: string, path: string, token: string, init: { params?: Record<string, string>; json?: unknown; form?: FormData; raw?: Uint8Array; headers?: Record<string, string> } = {}): Promise<T> {
  const url = path.startsWith("http") ? new URL(path) : new URL(`${base()}/${version()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...init.headers };
  let body: BodyInit | undefined;
  if (init.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.json); }
  else if (init.form) body = init.form;
  else if (init.raw) body = init.raw as unknown as BodyInit;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, cache: "no-store", signal: AbortSignal.timeout(20_000) } as RequestInit);
  } catch (e) {
    throw networkError(e);
  }
  const data = (await res.json().catch(() => ({}))) as Body;
  if (res.ok) return data as T;
  const err = data.error ?? {};
  throw new GraphError(res.status, err.code ?? 0, err.error_data?.details ?? err.message ?? `HTTP ${res.status}`, false, err.error_subcode);
}

export async function graphGet<T>(path: string, token: string, params: Record<string, string> = {}, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await call<T>("GET", path, token, { params });
    } catch (e) {
      const g = e instanceof GraphError ? e : networkError(e);
      // GETs are safe to repeat, so ambiguous outcomes retry too
      const retry = g.ambiguous || isRetryable(g);
      if (!retry || i >= tries - 1) throw g;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i + Math.random() * 250));
    }
  }
}

export const graphPost = <T>(path: string, token: string, json: unknown) => call<T>("POST", path, token, { json });
export const graphDelete = <T>(path: string, token: string, params: Record<string, string>) => call<T>("DELETE", path, token, { params });

export type MetaPhone = {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  status?: string;
  name_status?: string;
  quality_rating?: string;
  throughput?: { level?: string };
  whatsapp_business_manager_messaging_limit?: string;
  messaging_limit_tier?: string;
};

const PHONE_FIELDS = "id,display_phone_number,verified_name,status,name_status,quality_rating,throughput";

/** Messaging limits are portfolio-level since v24; fall back to the deprecated field if Meta rejects the new one. */
export async function listPhoneNumbers(wabaId: string, token: string): Promise<MetaPhone[]> {
  try {
    return (await graphGet<{ data: MetaPhone[] }>(`${wabaId}/phone_numbers`, token, { fields: `${PHONE_FIELDS},whatsapp_business_manager_messaging_limit` })).data;
  } catch (e) {
    if (!(e instanceof GraphError) || e.code !== 100) throw e;
    return (await graphGet<{ data: MetaPhone[] }>(`${wabaId}/phone_numbers`, token, { fields: `${PHONE_FIELDS},messaging_limit_tier` })).data;
  }
}

export type TokenInfo = { valid: boolean; expiresAt: Date | null; scopes: string[] } | null;

/** debug_token needs the app token (APP_ID|APP_SECRET). Returns null when META_APP_ID is not set. */
export async function inspectToken(token: string): Promise<TokenInfo> {
  const appId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!appId || !secret) return null;
  const r = await graphGet<{ data: { is_valid?: boolean; expires_at?: number; scopes?: string[] } }>("debug_token", `${appId}|${secret}`, { input_token: token });
  const exp = r.data.expires_at ?? 0;
  return { valid: !!r.data.is_valid, expiresAt: exp > 0 ? new Date(exp * 1000) : null, scopes: r.data.scopes ?? [] };
}

/** POST /{phone-number-id}/media (multipart). Returns the media id to reference in a message. */
export async function uploadMedia(metaPhoneId: string, token: string, bytes: Uint8Array, mime: string, filename: string) {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", mime);
  form.set("file", new Blob([bytes as unknown as ArrayBuffer], { type: mime }), filename);
  return (await call<{ id: string }>("POST", `${metaPhoneId}/media`, token, { form })).id;
}

/** GET /{media-id} gives a short-lived URL; the URL itself needs the same bearer token. */
export async function downloadMedia(mediaId: string, token: string, maxBytes = 100 * 1024 * 1024) {
  const meta = await graphGet<{ url: string; mime_type?: string; file_size?: number }>(mediaId, token);
  if (meta.file_size && meta.file_size > maxBytes) throw new GraphError(413, 0, `media is ${meta.file_size} bytes, over the ${maxBytes} limit`);
  let res: Response;
  try {
    res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) throw new GraphError(res.status, 0, `media download failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new GraphError(413, 0, "media over the size limit");
  return { bytes, mime: meta.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream" };
}

/** Resumable Upload API: returns a handle for template media headers and profile photos. Needs META_APP_ID. */
export async function resumableUpload(token: string, bytes: Uint8Array, mime: string, filename: string) {
  const appId = process.env.META_APP_ID;
  if (!appId) throw new GraphError(0, 0, "META_APP_ID is not set, so files cannot be uploaded to Meta");
  const session = await call<{ id: string }>("POST", `${appId}/uploads`, token, {
    params: { file_name: filename, file_length: String(bytes.byteLength), file_type: mime },
  });
  const r = await call<{ h: string }>("POST", session.id, token, { raw: bytes, headers: { Authorization: `OAuth ${token}`, file_offset: "0" } });
  return r.h;
}

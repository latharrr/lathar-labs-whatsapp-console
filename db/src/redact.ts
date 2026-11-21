/** Strip secrets before anything reaches a log line or a stored error message. */
const PATTERNS: [RegExp, string][] = [
  [/\bEA[A-Za-z0-9]{20,}\b/g, "[meta-token]"], // Meta access tokens start with EAA...
  [/\bll_(live|test)_[A-Za-z0-9_-]{16,}\b/g, "[api-key]"],
  [/(Bearer|OAuth)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [/(access_token|input_token|client_secret|password|secret|token)=([^&\s"]+)/gi, "$1=[redacted]"],
  [/("(?:access_token|token|secret|password|apiKey|api_key|authorization)"\s*:\s*")[^"]*(")/gi, "$1[redacted]$2"],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, "[anthropic-key]"],
];

export function redact(input: unknown): string {
  let s = input instanceof Error ? input.message : typeof input === "string" ? input : JSON.stringify(input);
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  for (const name of ["META_APP_SECRET", "ENCRYPTION_KEY", "NEXTAUTH_SECRET", "ANTHROPIC_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const v = process.env[name];
    if (v && v.length >= 8) s = s.split(v).join(`[${name}]`);
  }
  return s;
}

export const log = {
  info: (...a: unknown[]) => console.log(...a.map(redact)),
  error: (...a: unknown[]) => console.error(...a.map(redact)),
};

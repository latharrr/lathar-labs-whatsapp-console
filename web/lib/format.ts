const nf = new Intl.NumberFormat("en-IN");
export const int = (n: number) => nf.format(n);

/** "96.8%" -> ["96", ".8%"] so the decimal can be set smaller (bar.md #3). */
export function pctParts(p: number | null): [string, string] {
  if (p === null) return ["—", ""];
  const [w, f] = p.toFixed(1).split(".");
  return [w, `.${f}%`];
}

export function money(n: number, currency: string): [string, string] {
  const s = new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
  const i = s.lastIndexOf(".");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i)];
}

export function ago(d: Date | null) {
  if (!d) return "never";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
}

export const quality = (q?: string | null) =>
  ({ GREEN: { label: "High", tone: "ok" }, YELLOW: { label: "Medium", tone: "warn" }, RED: { label: "Low", tone: "err" } } as const)[q ?? ""] ??
  ({ label: "Unknown", tone: "neutral" } as const);

export { limitLabel as limit } from "@ll/db";

import { cn } from "@/lib/cn";

const tones = { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", err: "bg-err-bg text-err", neutral: "bg-surface text-muted" };
export type Tone = keyof typeof tones;

/** Status colour lives only in chips (bar.md #6). Text-on-tint pairs are >= 4.5:1. */
export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

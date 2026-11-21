import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Card } from "./card";
import { Chip } from "./chip";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[200px] flex-1">
        <h1 className="text-[28px] font-[380] leading-9 tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="flex flex-col items-start gap-3 py-10">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-prose text-muted">{body}</p>
      {action}
    </Card>
  );
}

export const TestChip = () => <Chip tone="warn">Test account</Chip>;

export const th = "border-b border-line py-2 pr-3 text-left text-[13px] font-medium text-muted";
export const td = "border-b border-line py-2.5 pr-3 align-top";

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn("h-10 w-full rounded-control border border-line-strong bg-raised px-2.5 text-sm text-fg", className)} {...p} />
));
Select.displayName = "Select";

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn("min-h-[84px] w-full rounded-control border border-line-strong bg-raised px-3 py-2 text-sm text-fg placeholder:text-muted", className)} {...p} />
));
Textarea.displayName = "Textarea";

/** Status words people read; colour lives in the chip (bar.md #6). */
export function StatusChip({ status }: { status: string | null }) {
  const s = status ?? "accepted";
  const tone = ["delivered", "read", "sent", "completed", "running", "ok", "opted_in", "APPROVED", "stored"].includes(s) ? "ok"
    : ["failed", "blocked", "unknown", "cancelled", "opted_out", "REJECTED", "DISABLED"].includes(s) ? "err"
    : ["queued", "paused", "scheduled", "pending", "PENDING", "PAUSED", "skipped"].includes(s) ? "warn" : "neutral";
  const label = ({ opted_in: "Opted in", opted_out: "Opted out", unknown: "No opt-in", accepted: "Accepted by Meta" } as Record<string, string>)[s]
    ?? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, " ");
  return <Chip tone={tone}>{label}</Chip>;
}

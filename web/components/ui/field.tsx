import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn("h-10 w-full rounded-control border border-line-strong bg-raised px-3 text-sm text-fg placeholder:text-muted", className)}
    {...p}
  />
));
Input.displayName = "Input";

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

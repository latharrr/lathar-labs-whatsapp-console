import { forwardRef } from "react";
import { cn } from "@/lib/cn";

// primary = the one filled action on a screen (bar.md #1); secondary = neutral pill; ghost = icon/quiet.
const variants = {
  primary: "bg-accent text-accent-on font-semibold hover:bg-accent-hover border border-transparent",
  secondary: "bg-raised text-fg border border-line hover:bg-surface",
  ghost: "bg-transparent text-fg border border-transparent hover:bg-surface",
  danger: "bg-raised text-err border border-line hover:bg-err-bg",
};
export type Variant = keyof typeof variants;

export const buttonClass = (variant: Variant = "secondary", className?: string) =>
  cn(
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3.5 text-sm transition-colors duration-150 ease-out disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
    variants[variant],
    className,
  );

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  ({ variant, className, ...p }, ref) => <button ref={ref} className={buttonClass(variant, className)} {...p} />,
);
Button.displayName = "Button";

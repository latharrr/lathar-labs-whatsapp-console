"use client";
import { useFormStatus } from "react-dom";
import { Button, type Variant } from "./ui/button";

export function SubmitButton({ children, pending, variant = "primary" }: { children: React.ReactNode; pending: string; variant?: Variant }) {
  const { pending: busy } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={busy} aria-busy={busy}>{busy ? pending : children}</Button>;
}

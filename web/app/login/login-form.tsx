"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function LoginForm({ google }: { google: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-6 flex flex-col gap-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          await signIn("credentials", { email: f.get("email"), password: f.get("password"), callbackUrl: "/" });
          setBusy(false);
        }}
      >
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="username" required /></Field>
        <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
        <Button type="submit" variant="primary" disabled={busy} className="h-10">{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
      {google && <Button variant="secondary" className="h-10" onClick={() => signIn("google", { callbackUrl: "/" })}>Continue with Google</Button>}
    </div>
  );
}

"use client";
import { signOut } from "next-auth/react";

export function SignOut() {
  return <button onClick={() => signOut({ callbackUrl: "/login" })} className="self-start text-xs text-muted underline-offset-2 hover:underline">Sign out</button>;
}

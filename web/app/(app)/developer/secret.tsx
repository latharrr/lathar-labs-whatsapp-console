"use client";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import type { ActionState } from "@/lib/server";

/** Shows a just-created secret once, with a copy button. */
export function SecretForm({ action, children }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; children: React.ReactNode }) {
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <ActionForm action={action} resetOnOk onOk={(s) => { setSecret(String(s.data?.key ?? "")); setCopied(false); }} className="flex flex-col gap-3">{children}</ActionForm>
      {secret && (
        <div role="status" className="rounded-control border border-line-strong bg-warn-bg p-3 text-sm">
          <p className="font-medium text-warn">Copy this now. It is not shown again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[13px]">{secret}</code>
            <button type="button" className="h-8 rounded-full border border-line bg-raised px-3 text-sm" onClick={() => navigator.clipboard.writeText(secret).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

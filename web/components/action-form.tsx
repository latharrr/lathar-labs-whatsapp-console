"use client";
import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { toast } from "sonner";
import type { ActionState } from "@/lib/server";
import { SubmitButton } from "./submit-button";
import { Button, type Variant } from "./ui/button";

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;

/** Toast from the resolved action, not an effect: the form may unmount when the page re-renders (e.g. an opt-out hides its own button). */
const withToast = (action: Action): Action => async (s, f) => {
  const r = await action(s, f);
  if (r.ok) toast.success(r.ok);
  if (r.error) toast.error(r.error);
  return r;
};

function useResult(state: ActionState, onOk?: (s: ActionState) => void) {
  const last = useRef<ActionState>(state);
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) onOk?.(state);
  }, [state, onOk]);
}

/** A form bound to a server action; shows the result as a toast and keeps the error inline. */
export function ActionForm({ action, children, className, resetOnOk, onOk }: { action: Action; children: React.ReactNode; className?: string; resetOnOk?: boolean; onOk?: (s: ActionState) => void }) {
  const [state, run] = useFormState(withToast(action), {});
  const ref = useRef<HTMLFormElement>(null);
  useResult(state, (s) => { if (resetOnOk) ref.current?.reset(); onOk?.(s); });
  return (
    <form ref={ref} action={run} className={className}>
      {children}
      {state.error && <p role="alert" className="mt-2 rounded-control bg-err-bg px-3 py-2 text-sm text-err">{state.error}</p>}
    </form>
  );
}

/** Sends and deletes always confirm (spec: confirm dialogs on sends and deletes). */
export function ConfirmForm({ action, hidden = {}, label, title, body, confirm, variant = "secondary", tone = "primary", disabled }: {
  action: Action; hidden?: Record<string, string>; label: React.ReactNode; title: string; body: React.ReactNode; confirm: string; variant?: Variant; tone?: "primary" | "danger"; disabled?: boolean;
}) {
  const [state, run] = useFormState(withToast(action), {});
  const dialog = useRef<HTMLDialogElement>(null);
  useResult(state, () => dialog.current?.close());
  return (
    <form action={run}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Button type="button" variant={variant} disabled={disabled} onClick={() => dialog.current?.showModal()}>{label}</Button>
      <dialog ref={dialog} className="w-[min(440px,calc(100vw-32px))] rounded-card border border-line bg-raised p-0 text-fg shadow-float backdrop:bg-black/40">
        <div className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="text-sm text-muted">{body}</div>
          {state.error && <p role="alert" className="rounded-control bg-err-bg px-3 py-2 text-sm text-err">{state.error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" onClick={() => dialog.current?.close()}>Cancel</Button>
            <SubmitButton variant={tone === "danger" ? "danger" : "primary"} pending="Working…">{confirm}</SubmitButton>
          </div>
        </div>
      </dialog>
    </form>
  );
}

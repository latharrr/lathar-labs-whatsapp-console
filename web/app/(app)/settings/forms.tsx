"use client";
import { useEffect } from "react";
import { useFormState } from "react-dom";
import { toast } from "sonner";
import { connectWaba, syncWaba, type FormState } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input } from "@/components/ui/field";

function useToast(state: FormState) {
  useEffect(() => {
    if (state.ok) toast.success(state.ok);
    if (state.error) toast.error(state.error);
  }, [state]);
}

export function ConnectForm() {
  const [state, action] = useFormState(connectWaba, {});
  useToast(state);
  return (
    <form action={action} className="flex flex-col gap-4" autoComplete="off">
      <Field label="WhatsApp Business Account ID" htmlFor="wabaId" hint="WhatsApp Manager > Account tools > the numeric account ID.">
        <Input id="wabaId" name="wabaId" inputMode="numeric" required className="tnum" />
      </Field>
      <Field label="System User access token" htmlFor="token" hint="Business settings > System users > Generate token, with business_management, whatsapp_business_management and whatsapp_business_messaging. Stored encrypted; never shown again.">
        <Input id="token" name="token" type="password" required spellCheck={false} />
      </Field>
      {state.error && <p role="alert" className="rounded-control bg-err-bg px-3 py-2 text-sm text-err">{state.error}</p>}
      <div><SubmitButton pending="Checking with Meta…">Connect account</SubmitButton></div>
    </form>
  );
}

export function SyncForm({ id, disabled }: { id: string; disabled?: boolean }) {
  const [state, action] = useFormState(syncWaba, {});
  useToast(state);
  if (disabled) return null;
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="secondary" pending="Syncing…">Sync from Meta</SubmitButton>
    </form>
  );
}

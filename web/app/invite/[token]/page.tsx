import { ActionForm } from "@/components/action-form";
import { Wordmark } from "@/components/nav";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input } from "@/components/ui/field";
import { acceptInvite, inviteInfo } from "./actions";

export const metadata = { title: "Join workspace" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const inv = await inviteInfo(params.token);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center gap-6 px-4 py-12">
      <Wordmark />
      {!inv ? (
        <div className="rounded-card border border-line bg-raised p-6"><h1 className="text-xl font-semibold">This invite no longer works</h1><p className="mt-2 text-muted">It expired or was already used. Ask the person who invited you for a new link.</p></div>
      ) : (
        <div className="rounded-card border border-line bg-raised p-6">
          <h1 className="text-xl font-semibold">Join {inv.org}</h1>
          <p className="mt-1 text-muted">As {inv.role.toLowerCase()}, with {inv.email}.</p>
          <ActionForm action={acceptInvite} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="token" value={params.token} />
            {inv.existing ? <p className="text-sm text-muted">You already have an account. Join, then sign in with your usual password.</p> : <>
              <Field label="Your name" htmlFor="name"><Input id="name" name="name" autoComplete="name" /></Field>
              <Field label="Password" htmlFor="password" hint="At least 10 characters."><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
              <Field label="Repeat password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
            </>}
            <div><SubmitButton pending="Joining…">Join workspace</SubmitButton></div>
          </ActionForm>
        </div>
      )}
    </main>
  );
}

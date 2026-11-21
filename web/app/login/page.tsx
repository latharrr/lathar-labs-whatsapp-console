import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, googleEnabled } from "@/lib/auth";
import { Wordmark } from "@/components/nav";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  CredentialsSignin: "That email and password did not match, or there were too many tries. Wait a minute and try again.",
  NotInvited: "That Google account is not on the team. Ask an Owner or Admin to add your email.",
  NoWorkspace: "Your account is not part of a workspace yet.",
  Unavailable: "Sign-in is unavailable right now: the server cannot reach its database. Try again shortly.",
};

export default async function Login({ searchParams }: { searchParams: { error?: string; joined?: string } }) {
  if (await getServerSession(authOptions)) redirect("/");
  const error = searchParams.error ? (ERRORS[searchParams.error] ?? "Sign-in failed. Try again.") : null;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-raised p-8">
        <Wordmark />
        <h1 className="mt-6 text-[28px] font-[380] leading-9 tracking-[-0.01em]">Sign in</h1>
        <p className="mt-1 text-muted">WhatsApp Business dashboard</p>
        {searchParams.joined && <p role="status" className="mt-4 rounded-control bg-ok-bg px-3 py-2 text-sm text-ok">You joined the workspace. Sign in to continue.</p>}
        {error && <p role="alert" className="mt-4 rounded-control bg-err-bg px-3 py-2 text-sm text-err">{error}</p>}
        <LoginForm google={googleEnabled} />
      </div>
    </main>
  );
}

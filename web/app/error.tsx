"use client";
// Catches errors thrown by the (app) layout itself (e.g. the database is down during the session check),
// which the (app)/error.tsx boundary cannot catch because it sits inside that layout.
import AppError from "./(app)/error";

export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-[640px] px-4 py-16">
      <p className="mb-6 text-base font-semibold tracking-[-0.01em]">Lathar <span className="text-muted">Labs</span></p>
      <AppError {...props} />
    </main>
  );
}

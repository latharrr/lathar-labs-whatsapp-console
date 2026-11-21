// Unknown URLs outside the signed-in app shell get the same message, with the brand like the root error page.
import AppNotFound from "./(app)/not-found";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-[640px] px-4 py-16">
      <p className="mb-6 text-base font-semibold tracking-[-0.01em]">Lathar <span className="text-muted">Labs</span></p>
      <AppNotFound />
    </main>
  );
}

"use client";
import { Button } from "@/components/ui/button";

// Production builds replace server error messages with a generic one, so only show the message in development.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const dev = process.env.NODE_ENV !== "production";
  return (
    <div role="alert" className="rounded-card border border-line bg-raised p-8">
      <h1 className="text-xl font-semibold">This page could not load</h1>
      <p className="mt-2 text-muted">
        {dev && error.message ? error.message : "Something went wrong on the server. Nothing was changed."}
        {error.digest && <span className="block text-xs">Reference: <span className="font-mono">{error.digest}</span></span>}
      </p>
      <p className="mt-2 text-sm text-muted">{dev ? <>If the database is not running, start it with <code className="font-mono">docker compose up -d</code>, then try again.</> : "Try again. If it keeps happening, send the reference above to whoever runs this dashboard."}</p>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Realtime: listens to /api/stream (Server-Sent Events from Redis pub/sub, scoped to this workspace) and
 * refreshes the server-rendered page. Debounced so a burst of statuses is one refresh.
 */
export function LiveRefresh({ types }: { types?: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource("/api/stream");
    es.onopen = () => setState("live");
    es.onerror = () => setState("offline");
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (types && !types.includes(ev.type)) return;
      } catch { return; }
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    return () => { clearTimeout(timer); es.close(); };
  }, [router, types]);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
      <span aria-hidden className={`size-1.5 rounded-full ${state === "live" ? "bg-ok" : state === "offline" ? "bg-err" : "bg-line-strong"}`} />
      {state === "live" ? "Live" : state === "offline" ? "Live updates paused (reconnecting)" : "Connecting"}
    </span>
  );
}

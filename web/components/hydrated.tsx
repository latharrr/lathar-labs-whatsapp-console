"use client";
import { useEffect } from "react";

/** Marks the page as interactive (used by the e2e suite instead of network idle, which SSE prevents). */
export function Hydrated() {
  useEffect(() => {
    const html = document.documentElement;
    // a failed server render makes React rebuild <html> on the client, dropping the theme set by the inline script
    try { const t = localStorage.getItem("theme"); if ((t === "light" || t === "dark") && !html.dataset.theme) html.dataset.theme = t; } catch { /* private mode */ }
    html.dataset.hydrated = "1";
  }, []);
  return null;
}

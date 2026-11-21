"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* private mode: still flips for this page */ }
  };
  return (
    <button onClick={flip} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} className="inline-flex size-9 items-center justify-center rounded-control hover:bg-surface">
      <Icon name={dark ? "sun" : "moon"} />
    </button>
  );
}

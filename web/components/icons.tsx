// Inline stroke icons (16px), aria-hidden: the label next to them carries the meaning.
const paths = {
  overview: "M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-3H4z",
  inbox: "M4 13l2.5-8h11L20 13v6H4zM4 13h4.5l1.5 2.5h4L15.5 13H20",
  contacts: "M16 19v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  templates: "M6 4h9l3 3v13H6zM9 11h6M9 15h6",
  campaigns: "M4 10v4l12 5V5zM16 9a3 3 0 0 1 0 6",
  automations: "M13 3 5 14h6l-1 7 8-11h-6z",
  analytics: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  developer: "m8 8-5 4 5 4M16 8l5 4-5 4",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5",
  plus: "M12 5v14M5 12h14",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 5v3h3M4 13a8 8 0 0 0 14.9 3M20 19v-3h-3",
  up: "M7 17 17 7M9 7h8v8",
  down: "M7 7l10 10M17 9v8H9",
  chevron: "m6 9 6 6 6-6",
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={paths[name]} />
    </svg>
  );
}

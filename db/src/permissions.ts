import type { Role } from "@prisma/client";

/** One permission matrix for server actions and the public API. The UI hides what this denies. */
const MATRIX = {
  "inbox.read": ["OWNER", "ADMIN", "AGENT", "VIEWER"],
  "inbox.reply": ["OWNER", "ADMIN", "AGENT"],
  "inbox.assign": ["OWNER", "ADMIN", "AGENT"],
  "contacts.read": ["OWNER", "ADMIN", "AGENT", "VIEWER"],
  "contacts.write": ["OWNER", "ADMIN", "AGENT"],
  "contacts.import": ["OWNER", "ADMIN"],
  "contacts.export": ["OWNER", "ADMIN"],
  "contacts.delete": ["OWNER", "ADMIN"],
  "templates.write": ["OWNER", "ADMIN"],
  "campaigns.write": ["OWNER", "ADMIN"],
  "campaigns.send": ["OWNER", "ADMIN"],
  "automations.write": ["OWNER", "ADMIN"],
  "analytics.read": ["OWNER", "ADMIN", "AGENT", "VIEWER"],
  "analytics.export": ["OWNER", "ADMIN"],
  "developer.manage": ["OWNER", "ADMIN"],
  "settings.manage": ["OWNER", "ADMIN"],
  "team.manage": ["OWNER", "ADMIN"],
  "team.owners": ["OWNER"],
  "audit.read": ["OWNER", "ADMIN"],
} satisfies Record<string, Role[]>;

export type Action = keyof typeof MATRIX;
export const can = (role: Role, action: Action) => (MATRIX[action] as readonly Role[]).includes(role);
export const API_SCOPES = ["messages:send", "contacts:write", "events:write", "read"] as const;

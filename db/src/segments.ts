import type { Prisma } from "@prisma/client";

export type Condition = { field: string; op: string; value?: string };
export type Rules = { match: "all" | "any"; conditions: Condition[] };

export const FIELDS = [
  { field: "tag", label: "Tag", ops: ["has", "not_has"] },
  { field: "optIn", label: "Marketing opt-in", ops: ["is", "is_not"], values: ["opted_in", "opted_out", "unknown"] },
  { field: "name", label: "Name", ops: ["contains"] },
  { field: "attr", label: "Attribute", ops: ["equals", "contains", "exists", "not_exists"] }, // value "key=value"
  { field: "lastInbound", label: "Last message from them", ops: ["within_days", "not_within_days"] },
  { field: "createdAt", label: "Added", ops: ["within_days", "before_days"] },
] as const;

const days = (v?: string) => new Date(Date.now() - Math.max(0, Number(v) || 0) * 86_400_000);

function one(c: Condition): Prisma.ContactWhereInput | null {
  const v = (c.value ?? "").trim();
  switch (c.field) {
    case "tag":
      return c.op === "not_has" ? { tags: { none: { tag: { name: v } } } } : { tags: { some: { tag: { name: v } } } };
    case "optIn":
      return c.op === "is_not" ? { optInStatus: { not: v } } : { optInStatus: v };
    case "name":
      return { OR: [{ name: { contains: v, mode: "insensitive" } }, { profileName: { contains: v, mode: "insensitive" } }] };
    case "attr": {
      const [key, ...rest] = v.split("=");
      const val = rest.join("=");
      if (c.op === "exists") return { attributes: { some: { key } } };
      if (c.op === "not_exists") return { attributes: { none: { key } } };
      if (c.op === "contains") return { attributes: { some: { key, value: { contains: val, mode: "insensitive" } } } };
      return { attributes: { some: { key, value: val } } };
    }
    case "lastInbound":
      return c.op === "not_within_days"
        ? { conversations: { none: { lastInboundAt: { gte: days(v) } } } }
        : { conversations: { some: { lastInboundAt: { gte: days(v) } } } };
    case "createdAt":
      return c.op === "before_days" ? { createdAt: { lt: days(v) } } : { createdAt: { gte: days(v) } };
    default:
      return null;
  }
}

/** Rules -> a Prisma filter, always scoped to the workspace. Unknown fields are rejected, not ignored. */
export function segmentWhere(orgId: string, rules: Rules): Prisma.ContactWhereInput {
  const parts = rules.conditions.map((c) => {
    const w = one(c);
    if (!w) throw new Error(`unknown segment field ${c.field}`);
    return w;
  });
  if (!parts.length) return { orgId };
  return { orgId, ...(rules.match === "any" ? { OR: parts } : { AND: parts }) };
}

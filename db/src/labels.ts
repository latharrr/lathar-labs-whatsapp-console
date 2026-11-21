/** Plain-English labels for Meta codes. The raw code stays visible as a secondary detail. */

// "TIER_1K" -> "1,000 customers / 24h". The limit counts customers you can start chats with per rolling 24 hours.
export function limitLabel(tier?: string | null): string {
  if (!tier) return "Unknown";
  if (tier === "TIER_UNLIMITED") return "Unlimited";
  const m = /^TIER_(\d+)(K?)$/.exec(tier);
  if (!m) return tier;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return `${new Intl.NumberFormat("en-IN").format(n)} customers / 24h`;
}

const TEMPLATE_REASONS: Record<string, string> = {
  INVALID_FORMAT: "Meta found a formatting problem, such as misplaced or unnumbered variables. Fix it and resubmit.",
  PROMOTIONAL: "Meta judged the content promotional for its category. Reword it or resubmit it as Marketing.",
  INCORRECT_CATEGORY: "Meta says it belongs in a different category. Resubmit it with that category.",
  TAG_CONTENT_MISMATCH: "The content does not match the category it was submitted under.",
  ABUSIVE_CONTENT: "Meta found content that breaks its policies.",
  SCAM: "Meta flagged it as a possible scam.",
};

export function templateReason(reason?: string | null): string | undefined {
  if (!reason || reason === "NONE") return undefined;
  return `${TEMPLATE_REASONS[reason] ?? "Meta did not explain this reason code."} (Meta code: ${reason})`;
}

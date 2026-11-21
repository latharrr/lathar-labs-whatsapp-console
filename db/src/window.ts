export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Customer service window: free-form replies allowed until 24h after the customer's last message. */
export function windowClosesAt(lastInboundAt: Date | null | undefined): Date | null {
  return lastInboundAt ? new Date(lastInboundAt.getTime() + WINDOW_MS) : null;
}

export function isWindowOpen(lastInboundAt: Date | null | undefined, now = new Date()): boolean {
  const closes = windowClosesAt(lastInboundAt);
  return !!closes && now < closes;
}

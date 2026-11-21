/** Side effects processing can trigger. The worker passes BullMQ jobs; tests and the seed pass these fakes. */
export interface Jobs {
  send(outboundId: string, delayMs?: number): Promise<void>;
  media(messageId: string): Promise<void>;
  automation(messageId: string): Promise<void>;
  deliver(deliveryId: string, delayMs?: number): Promise<void>;
  /** realtime: tells open dashboards in this workspace that something changed */
  publish(orgId: string, event: Record<string, unknown>): Promise<void>;
}

export const noJobs: Jobs = {
  send: async () => {}, media: async () => {}, automation: async () => {}, deliver: async () => {}, publish: async () => {},
};

export type Recorded = { kind: keyof Jobs; args: unknown[] };
export function recordingJobs(): Jobs & { calls: Recorded[]; of: (k: keyof Jobs) => unknown[][] } {
  const calls: Recorded[] = [];
  const rec = (kind: keyof Jobs) => async (...args: unknown[]) => { calls.push({ kind, args }); };
  return {
    calls,
    of: (k) => calls.filter((c) => c.kind === k).map((c) => c.args),
    send: rec("send"), media: rec("media"), automation: rec("automation"), deliver: rec("deliver"), publish: rec("publish"),
  };
}

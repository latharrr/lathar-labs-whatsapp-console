import { notFound } from "next/navigation";
import { prisma } from "@ll/db";
import { ConfirmForm } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader, StatusChip } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";
import { replayEvent } from "../../actions";

export const metadata = { title: "Event" };
export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: { id: string } }) {
  const m = await requirePage("developer.manage");
  const e = await prisma.webhookEvent.findFirst({ where: { id: params.id, orgId: m.orgId } });
  if (!e) notFound();
  let pretty = e.rawBody;
  try { pretty = JSON.stringify(JSON.parse(e.rawBody), null, 2); } catch {}
  return (
    <>
      <PageHeader title={e.field ?? "Webhook event"} subtitle={<>Received {e.receivedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {e.processedAt ? `processed ${e.processedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : "not processed"} · {e.attempts} attempt{e.attempts === 1 ? "" : "s"}</>}
        actions={<ConfirmForm action={replayEvent} hidden={{ id: e.id }} label="Replay" title="Process this event again?" body="It runs through the same processor. Messages, statuses and alerts that already exist are skipped, so a replay cannot create duplicates or send anything." confirm="Replay" />} />
      <Card>
        <CardTitle aside={<StatusChip status={e.processedAt ? "ok" : e.attempts ? "failed" : "pending"} />}>Result</CardTitle>
        {e.lastError && <p className="rounded-control bg-err-bg px-3 py-2 text-sm text-err">{e.lastError}</p>}
        {e.note && <p className="text-sm text-muted">{e.note}</p>}
        {!e.lastError && !e.note && <p className="text-sm text-muted">Processed without notes.</p>}
      </Card>
      <Card>
        <CardTitle>Raw payload (exact bytes Meta signed)</CardTitle>
        <pre className="max-h-[60vh] overflow-auto rounded-control bg-surface p-3 font-mono text-xs">{pretty}</pre>
      </Card>
    </>
  );
}

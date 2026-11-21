import { listConversations, type InboxFilters } from "@/lib/inbox";
import { requirePage } from "@/lib/session";
import { LiveRefresh } from "@/components/live";
import { PageHeader } from "@/components/ui/kit";
import { ConversationList } from "./views";
import { InboxKeys } from "./client";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: InboxFilters }) {
  const m = await requirePage("inbox.read");
  const data = await listConversations(m, searchParams);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Inbox" subtitle={<>{data.open} open · <LiveRefresh types={["message", "status", "outbound", "media"]} /></>} />
      <div className="grid gap-4 md:grid-cols-[340px_1fr]">
        <ConversationList data={data} filters={searchParams} className="md:h-[calc(100vh-200px)]" />
        <div className="hidden items-center justify-center rounded-card border border-dashed border-line-strong p-8 text-center text-muted md:flex">
          Pick a conversation. <span className="ml-1 hidden lg:inline">Press j and k to move through the list.</span>
        </div>
      </div>
      <InboxKeys ids={data.rows.map((r) => r.id)} />
    </div>
  );
}

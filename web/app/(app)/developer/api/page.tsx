import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";

export const metadata = { title: "API reference" };

const base = () => (process.env.PUBLIC_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3100").replace(/\/$/, "");
const ENDPOINTS = [
  { m: "POST", p: "/api/v1/messages", s: "messages:send", d: "Send a template (any time) or text (inside the 24-hour window). The same opt-in, opt-out, block and window rules as the inbox apply. Returns 202 with an id.",
    ex: `{ "to": "+919876543210", "type": "template", "template": { "name": "order_update", "language": "en", "values": { "body.1": "A-77" } }, "idempotencyKey": "order-A-77" }` },
  { m: "GET", p: "/api/v1/messages?id=…", s: "read", d: "Where a message is: queued, sent, failed, blocked, and Meta's delivery status.", ex: "" },
  { m: "POST", p: "/api/v1/contacts", s: "contacts:write", d: "Create or update a contact by phone. An opt-in needs source and proof and never overrides an opt-out.",
    ex: `{ "phone": "+919876543210", "name": "Asha", "attributes": { "city": "Delhi" }, "tags": ["vip"], "optIn": { "source": "checkout", "proof": "order A-77" } }` },
  { m: "GET", p: "/api/v1/contacts?phone=…", s: "read", d: "Read a contact. Logged as personal-data access.", ex: "" },
  { m: "POST", p: "/api/v1/events", s: "events:write", d: "Tell the dashboard something happened. Matching event automations send their template; conversion and order.placed count as campaign conversions.",
    ex: `{ "name": "order.placed", "phone": "+919876543210", "data": { "orderId": "A-77" }, "idempotencyKey": "order-A-77" }` },
];

export default async function ApiPage() {
  await requirePage("analytics.read");
  return (
    <>
      <PageHeader title="API reference" subtitle={<>Send <code className="font-mono">Authorization: Bearer ll_live_…</code>. 120 requests a minute per key. Errors are JSON: <code className="font-mono">{"{ \"error\": \"…\" }"}</code>.</>} />
      {ENDPOINTS.map((e) => (
        <Card key={e.m + e.p}>
          <CardTitle aside={<span className="font-mono text-xs text-muted">scope {e.s}</span>}><span className="font-mono">{e.m} {e.p}</span></CardTitle>
          <p className="text-sm">{e.d}</p>
          {e.ex && <pre className="mt-2 overflow-x-auto rounded-control bg-surface p-3 font-mono text-xs">{`curl -X ${e.m} ${base()}${e.p} \\\n  -H "Authorization: Bearer $LL_API_KEY" -H "Content-Type: application/json" \\\n  -d '${e.ex}'`}</pre>}
        </Card>
      ))}
    </>
  );
}

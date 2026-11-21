import { META_ERRORS } from "@/lib/meta-errors";
import { RETRYABLE_CODES } from "@ll/db/src/graph";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader, td, th } from "@/components/ui/kit";
import { requirePage } from "@/lib/session";

export const metadata = { title: "Error codes" };

export default async function ErrorsPage({ searchParams }: { searchParams: { q?: string } }) {
  await requirePage("analytics.read");
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const rows = Object.entries(META_ERRORS).filter(([code, e]) => !q || code.includes(q) || e.meaning.toLowerCase().includes(q));
  return (
    <>
      <PageHeader title="Error code lookup" subtitle="Common Cloud API errors and what this dashboard does with them. Meta's error reference has the full list." />
      <form className="flex gap-2" action="/developer/errors"><label htmlFor="eq" className="sr-only">Code or words</label><Input id="eq" name="q" data-search defaultValue={searchParams.q} placeholder="131047 or window" className="h-9 max-w-xs" /><button className={buttonClass("secondary")}>Look up</button></form>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <p className="text-sm text-muted">Not in our list. Check Meta&apos;s error codes reference.</p> : (
          <table className="w-full border-collapse text-sm"><thead><tr><th className={th}>Code</th><th className={th}>Meaning</th><th className={th}>What happens here</th></tr></thead>
            <tbody>{rows.map(([code, e]) => <tr key={code}><td className={`${td} font-mono text-[13px]`}>{code}</td><td className={td}>{e.meaning}</td><td className={td}>{RETRYABLE_CODES.has(Number(code)) ? "Retried automatically with backoff" : code === "131050" ? "Not retried; the contact is opted out" : "Not retried"}</td></tr>)}</tbody></table>
        )}
      </Card>
    </>
  );
}

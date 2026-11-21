import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Shown for unknown URLs and for records that are not in this workspace (we never reveal which).
export default function NotFound() {
  return (
    <Card className="flex flex-col items-start gap-3 py-10">
      <h1 className="text-base font-semibold">Not found</h1>
      <p className="max-w-prose text-muted">This page or record does not exist in this workspace. It may have been deleted, or the link is wrong.</p>
      <Link href="/" className={buttonClass("secondary")}>Back to Overview</Link>
    </Card>
  );
}

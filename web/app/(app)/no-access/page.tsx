import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Empty } from "@/components/ui/kit";
import { requireMember } from "@/lib/session";

export const metadata = { title: "No access" };

export default async function NoAccess() {
  const m = await requireMember();
  return (
    <Empty title="You don't have access to that page" body={<>Your role in {m.orgName} is {m.role.toLowerCase()}. An Owner or Admin can change it under Settings, Team.</>}
      action={<Link href="/" className={buttonClass("secondary")}>Back to Overview</Link>} />
  );
}

import { cn } from "@/lib/cn";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-card border border-line bg-raised px-4 py-5 sm:px-6", className)} {...p} />;
}

export function CardTitle({ children, aside, id }: { children: React.ReactNode; aside?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h2 id={id} className="flex-1 text-sm font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

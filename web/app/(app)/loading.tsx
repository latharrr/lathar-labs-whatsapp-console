export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-6">
      <div className="h-9 w-48 animate-pulse rounded-control bg-surface" />
      <div className="h-24 animate-pulse rounded-card bg-surface" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-60 animate-pulse rounded-card bg-surface" />
        <div className="h-60 animate-pulse rounded-card bg-surface" />
      </div>
    </div>
  );
}

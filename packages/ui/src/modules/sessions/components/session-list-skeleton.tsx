export function SessionListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-0.5 border-b border-border px-4 py-3"
        >
          <span className="text-[13px]">
            <span className="inline-block h-[0.7em] w-1/2 rounded bg-muted align-middle" />
          </span>
          <span className="text-[11px]">
            <span className="inline-block h-[0.7em] w-1/4 rounded bg-muted/60 align-middle" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Placeholder rows while the session list first loads. Mirrors SessionRow's
 *  two lines — a title over a smaller timestamp — and its height: the bars sit
 *  inside spans with the same font-sizes, so each row's line box matches the
 *  real one and the list doesn't reflow. */
export function SessionListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-0.5 border-b border-border-light px-4 py-3"
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

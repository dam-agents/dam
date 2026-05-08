interface Props {
  rowHeight?: number;
  rows?: number;
}

/**
 * Placeholder rows shown while a list query is in flight.
 */
export function ListSkeleton({ rowHeight = 68, rows = 1 }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border bg-card animate-pulse"
          style={{ height: `${rowHeight}px` }}
        />
      ))}
    </div>
  );
}

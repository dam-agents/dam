import { Card } from "@/components/ui/card";

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
        <Card
          key={i}
          className="animate-pulse"
          style={{ height: `${rowHeight}px` }}
        />
      ))}
    </div>
  );
}

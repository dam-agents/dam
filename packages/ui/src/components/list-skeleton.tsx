import { Card } from "@/components/ui/card";

interface Props {
  rowHeight?: number;
  rows?: number;
  /** Replaces the stacked-rows wrapper, for a page whose real content is a grid. */
  className?: string;
}

export function ListSkeleton({
  rowHeight = 68,
  rows = 1,
  className = "flex flex-col gap-3",
}: Props) {
  return (
    <div className={className}>
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

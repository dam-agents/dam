import { TextSkeleton } from "@/components/ui/text-skeleton";

export function FeedFilterSkeleton() {
  return (
    <div className="flex w-full items-center justify-between">
      <span className="text-sm">
        <TextSkeleton width={104} tone="muted" />
      </span>
      <span className="text-sm">
        <TextSkeleton width={132} tone="muted" />
      </span>
    </div>
  );
}

export function WidgetSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm">
          <TextSkeleton width={112} tone="muted" />
        </p>
        <p className="text-sm">
          <TextSkeleton width={48} tone="muted" />
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 text-sm">
              <TextSkeleton width={i % 2 === 0 ? "70%" : "52%"} />
            </span>
            <span className="text-sm">
              <TextSkeleton width={40} tone="muted" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

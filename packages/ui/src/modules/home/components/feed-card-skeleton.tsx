import { TextSkeleton } from "@/components/ui/text-skeleton";

const TITLE_WIDTHS = ["62%", "48%", "70%"];

export function FeedCardSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="w-full rounded-2xl border border-border bg-card/80 p-5"
        >
          <div className="mb-1 flex items-center gap-1.5 text-sm">
            <TextSkeleton width={16} tone="muted" className="h-4 rounded-md" />
            <TextSkeleton width={96} tone="muted" />
          </div>
          <p className="text-[15px] leading-snug font-semibold">
            <TextSkeleton width={TITLE_WIDTHS[i % TITLE_WIDTHS.length]} />
          </p>
          <div className="-mx-5 -mb-5 mt-3 flex items-center justify-between border-t border-border px-5 py-2.5">
            <span className="text-sm">
              <TextSkeleton width={64} tone="muted" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

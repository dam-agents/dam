import { timeAgo } from "@/lib/format-time";

import type { FeedItem } from "../lib/feed-item.js";

interface Props {
  scheduleId: string;
  items: readonly FeedItem[];
  latest: FeedItem;
  now: Date;
  onDismiss?: () => void;
}

export function ScheduleGroupCard({ items, latest, now, onDismiss }: Props) {
  const title = latest.session.title ?? "Scheduled run";
  const count = items.length;

  return (
    <div
      data-testid="schedule-group-card"
      className="group w-full rounded-2xl border border-border bg-card/80 p-5 text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-medium text-foreground">
            {title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {count} runs &middot; latest {timeAgo(latest.at, now)}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

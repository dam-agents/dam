import type { BackgroundWorkItemView } from "api-server-api";

import { cn } from "@/lib/utils";

import { WorkingDots } from "./working-dots.js";

export function backgroundWorkLabel(
  items: readonly BackgroundWorkItemView[],
): string {
  return items
    .map((item) => item.description ?? item.command ?? item.id)
    .join("\n");
}

export function BackgroundWorkIndicator({
  items,
  className,
}: {
  items: readonly BackgroundWorkItemView[];
  className?: string;
}) {
  if (items.length === 0) return null;
  const label = backgroundWorkLabel(items);
  return (
    <span
      title={label}
      data-testid="background-work-indicator"
      className={cn(
        "inline-flex items-center gap-2 text-sm font-normal text-muted-foreground",
        className,
      )}
    >
      <WorkingDots size="md" className="working-dots-slow text-success" />
      {items.length === 1
        ? "Background task running…"
        : `${items.length} background tasks running…`}
    </span>
  );
}

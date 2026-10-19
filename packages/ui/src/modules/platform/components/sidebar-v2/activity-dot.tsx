import { cn } from "@/lib/utils";

import { ACTIVITY_LABEL, type ActivityTone } from "../../lib/sidebar-tree.js";

const DOT: Record<Exclude<ActivityTone, "working">, string> = {
  approval: "bg-warning",
  unread: "bg-success",
  idle: "bg-muted-foreground/35",
};

export function ActivityDot({ tone }: { tone: ActivityTone }) {
  const label = ACTIVITY_LABEL[tone];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="session-activity-dot"
      data-tone={tone}
      className="relative mt-0.5 flex size-4 shrink-0 items-center justify-center self-start"
    >
      {tone === "working" ? (
        <>
          <span className="size-3 animate-spin rounded-full border-[1.5px] border-accent/25 border-t-accent motion-reduce:animate-none" />
          <span className="absolute size-1.5 rounded-full bg-accent" />
        </>
      ) : (
        <span className={cn("size-2 rounded-full", DOT[tone])} />
      )}
    </span>
  );
}

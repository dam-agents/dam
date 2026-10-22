import { Pen } from "@carbon/icons-react";

import { cn } from "@/lib/utils";

import { ACTIVITY_LABEL, type ActivityTone } from "../../lib/sidebar-tree.js";

const DOT: Record<"approval" | "unread" | "idle", string> = {
  approval: "bg-warning",
  unread: "bg-success",
  idle: "bg-muted-foreground/35",
};

export function ActivityDot({
  tone,
  label = ACTIVITY_LABEL[tone],
  className,
}: {
  tone: ActivityTone;
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="session-activity-dot"
      data-tone={tone}
      className={cn(
        "relative flex size-4 shrink-0 items-center justify-center",
        className,
      )}
    >
      {tone === "working" ? (
        <>
          <span className="size-3 animate-spin rounded-full border-[1.5px] border-accent/25 border-t-accent motion-reduce:animate-none" />
          <span className="absolute size-1.5 rounded-full bg-accent" />
        </>
      ) : tone === "background" ? (
        <span className="size-2.5 rounded-full border-[1.5px] border-success" />
      ) : tone === "draft" ? (
        <Pen size={12} aria-hidden className="text-muted-foreground" />
      ) : (
        <span className={cn("size-2.5 rounded-full", DOT[tone])} />
      )}
    </span>
  );
}

export function AgentCue({ tone }: { tone: "approval" | "unread" }) {
  return (
    <span
      data-testid="sidebar-agent-cue"
      data-tone={tone}
      className="flex shrink-0 items-center"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full group-hover/agent:hidden group-has-[:focus-visible]/agent:hidden",
          DOT[tone],
        )}
      />
      <span className="sr-only">({ACTIVITY_LABEL[tone].toLowerCase()})</span>
    </span>
  );
}

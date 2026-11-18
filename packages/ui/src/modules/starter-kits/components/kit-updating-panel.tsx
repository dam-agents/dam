import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

const RUNNING_BADGE =
  "shrink-0 cursor-pointer gap-1.5 border-kit-line bg-kit-surface text-kit";

export function kitUpdatingLabel(version: string): string {
  return `Kit updating to ${version}`;
}

export function KitUpdatingBadgeFace({
  version,
  className,
  ...props
}: { version: string } & ComponentProps<"button">) {
  return (
    <Badge variant="outline" className={cn(RUNNING_BADGE, className)} asChild>
      <button
        type="button"
        aria-label={kitUpdatingLabel(version)}
        data-testid="agent-kit-updating-badge"
        {...props}
      >
        <Spinner size={12} className="text-kit" />
        Kit updating
      </button>
    </Badge>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the panel a running Kit Update's tile badge
 * opens: the version it moves to, when the owner started it, and the way into
 * the chat where the agent asks what to take. Without the update's chat in the
 * agent's recent chats, the way in is the agent itself, whose bar continues it.
 */
export function KitUpdatingPanel({
  version,
  startedAt,
  hasChat,
  onOpen,
  now,
}: {
  version: string;
  startedAt: string;
  hasChat: boolean;
  onOpen: () => void;
  now?: Date;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="kit-updating">
      <p className="font-bold text-foreground">{kitUpdatingLabel(version)}</p>
      <p className="text-muted-foreground">
        Started{" "}
        <time dateTime={startedAt} title={formatTimestamp(startedAt)}>
          {timeAgo(startedAt, now)}
        </time>
        . The agent asks you in its chat which changes to take.
      </p>
      <Button
        variant="link"
        size="sm"
        className="self-start px-0"
        onClick={onOpen}
      >
        {hasChat ? "Open the update's chat" : "Open the agent"}
      </Button>
    </div>
  );
}

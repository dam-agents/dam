import { OverflowMenuVertical } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { timeAgo } from "../lib/format-time.js";
import { useStore } from "../store.js";

interface SidebarSessionItemProps {
  agentId: string;
  sessionId: string;
  title: string | null | undefined;
  running: boolean;
  updatedAt: string | null | undefined;
  seenAt: string | null | undefined;
  slackChannel: string | null | undefined;
  scheduleId: string | null | undefined;
  threadTs: string | null | undefined;
  onDelete?: () => void;
}

export function SidebarSessionItem({
  agentId,
  sessionId,
  title,
  running,
  updatedAt,
  seenAt,
  slackChannel,
  onDelete,
}: SidebarSessionItemProps) {
  const openAgentSession = useStore((s) => s.openAgentSession);
  const currentSessionId = useStore((s) => s.sessionId);
  const active = currentSessionId === sessionId;

  const unread =
    !!updatedAt && !!seenAt && new Date(updatedAt) > new Date(seenAt);
  const isRead = !running && !unread;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openAgentSession(agentId, sessionId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openAgentSession(agentId, sessionId);
        }
      }}
      className={cn(
        "group/session flex w-full gap-3 rounded-xl px-4 py-3 text-left transition-colors cursor-pointer hover:bg-muted/50",
        active && "bg-muted",
        (unread || running) &&
          !active &&
          "bg-[#f4f4f4]/50 dark:bg-white/[0.03]",
      )}
    >
      <div className="relative shrink-0 pt-1">
        {running && (
          <span className="working-dots flex items-center -space-x-[1px]">
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
          </span>
        )}
        {unread && !running && (
          <span className="size-2.5 rounded-full border-2 border-background bg-accent" />
        )}
        {isRead && <span className="size-2.5" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1 text-sm leading-snug">
          <p
            className={cn(
              "min-w-0 truncate",
              !isRead
                ? "font-semibold text-foreground"
                : "text-muted-foreground",
            )}
          >
            {title || sessionId.slice(0, 12)}
          </p>
          {slackChannel && (
            <span className="shrink-0 text-muted-foreground/60">
              #{slackChannel}
            </span>
          )}
        </div>
        {updatedAt && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {timeAgo(updatedAt)}
          </p>
        )}
      </div>

      {onDelete && (
        <div
          className="flex shrink-0 items-start pt-0.5 opacity-0 transition-opacity group-hover/session:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Session actions"
              >
                <OverflowMenuVertical size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem tone="danger" onSelect={onDelete}>
                Delete session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

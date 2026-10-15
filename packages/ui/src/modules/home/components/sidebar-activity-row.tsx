import { SessionType } from "api-server-api";

import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { WorkingDots } from "../../sessions/components/working-dots.js";
import type { AgentActivitySession } from "../hooks/use-activity-sessions.js";

const MESSENGERS: Partial<Record<SessionType, { slug: string; alt: string }>> =
  {
    [SessionType.ChannelSlack]: { slug: "slack", alt: "Slack" },
    [SessionType.ChannelTelegram]: { slug: "telegram", alt: "Telegram" },
  };

export function SidebarActivityRow({
  item,
  selected,
  now,
  conversation,
  onOpen,
}: {
  item: AgentActivitySession;
  selected: boolean;
  now: Date;
  conversation: string | undefined;
  onOpen: () => void;
}) {
  const { session, agent, at, working, unread } = item;
  const messenger = MESSENGERS[session.type];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? "page" : undefined}
        data-testid="sidebar-activity-row"
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors",
          selected ? "bg-muted" : "hover:bg-muted",
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm text-foreground",
              unread && "font-semibold",
            )}
          >
            {session.title ?? "Session"}
          </span>
          {working ? (
            <WorkingDots
              className="shrink-0 text-muted-foreground"
              title="Working"
            />
          ) : unread ? (
            <>
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-accent"
              />
              <span className="sr-only">(unread)</span>
            </>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{agent.name}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0" title={formatTimestamp(at)}>
            {timeAgo(at, now)}
          </span>
          {messenger && (
            <ConnectionIcon
              iconSlug={messenger.slug}
              alt={messenger.alt}
              size={12}
              className="ml-0.5 shrink-0"
            />
          )}
          {conversation && (
            <span
              data-testid="sidebar-activity-conversation"
              title={conversation}
              className="max-w-[60%] truncate"
            >
              {conversation}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

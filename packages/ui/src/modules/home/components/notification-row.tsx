import { EdgeDevice, Time, Warning } from "@carbon/icons-react";

import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import type { ArtifactTouched } from "../api/queries.js";
import { channelTypeFor } from "../lib/activity-filter.js";
import type { FeedItem } from "../lib/feed-item.js";
import { isUnreadItem } from "../lib/unread.js";
import { FeedArtifactChips } from "./feed-artifact-chips.js";

type RowKind = "agent" | "slack" | "telegram" | "schedule" | "approval";

const ICON_TINT: Record<RowKind, string> = {
  agent: "bg-[#f2f4f8] text-foreground dark:bg-white/10",
  slack:
    "bg-white border border-[#dde1e6] dark:bg-white/5 dark:border-white/10",
  telegram:
    "bg-white border border-[#dde1e6] dark:bg-white/5 dark:border-white/10",
  schedule:
    "bg-[#edf5ff] text-[#0f62fe] dark:bg-[#0f62fe]/15 dark:text-[#78a9ff]",
  approval: "bg-warning/10 text-warning",
};

function rowKind(item: FeedItem, agents: readonly AgentView[]): RowKind {
  if (item.kind === "approval") return "approval";
  const channel = channelTypeFor(item, agents);
  if (channel === "schedule") return "schedule";
  if (channel === "slack") return "slack";
  if (channel === "telegram") return "telegram";
  return "agent";
}

function rowIcon(kind: RowKind) {
  switch (kind) {
    case "schedule":
      return <Time size={16} />;
    case "slack":
      return <img src="/icons/slack.svg" alt="" className="size-4" />;
    case "telegram":
      return <img src="/icons/telegram.svg" alt="" className="size-4" />;
    case "approval":
      return <Warning size={16} />;
    default:
      return <EdgeDevice size={16} />;
  }
}

export function NotificationRow({
  item,
  agentName,
  agentAvatar,
  agents,
  meta,
  artifacts,
  onOpen,
  onDismiss,
  onOpenArtifact,
}: {
  item: Extract<FeedItem, { kind: "unread" | "in-progress" }>;
  agentName: string;
  agentAvatar: string;
  agents: readonly AgentView[];
  meta: string;
  artifacts: readonly ArtifactTouched[];
  onOpen: () => void;
  onDismiss?: () => void;
  onOpenArtifact: (artifactId: string) => void;
}) {
  const kind = rowKind(item, agents);
  const running = item.kind === "in-progress";
  const unread = isUnreadItem(item);

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="notification-row"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group flex w-full cursor-pointer gap-3 rounded-xl px-4 py-4 text-left transition-colors hover:bg-muted/50",
        (unread || running) && "bg-[#f4f4f4]/50 dark:bg-white/[0.03]",
      )}
    >
      <div className="relative shrink-0 pt-0.5">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            ICON_TINT[kind],
          )}
        >
          {rowIcon(kind)}
        </div>
        {running && (
          <span className="working-dots absolute top-0 -left-[8px] flex items-center -space-x-[1px]">
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
          </span>
        )}
        {unread && !running && (
          <span className="absolute top-0 -left-0.5 size-2.5 rounded-full border-2 border-background bg-accent" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm leading-snug">
          <AgentAvatar seed={agentAvatar} size={18} />
          <span className="min-w-0 truncate">
            <span
              className={cn("text-foreground", !running && "font-semibold")}
            >
              {agentName}
            </span>
            <span className="text-muted-foreground">
              {" "}
              {item.session.title ?? "Session"}
            </span>
          </span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          <FeedArtifactChips artifacts={artifacts} onOpen={onOpenArtifact} />
        </div>
      </div>

      <div className="flex shrink-0 items-start pt-0.5">
        {!running && onDismiss && (
          <button
            type="button"
            className="text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onDismiss();
            }}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

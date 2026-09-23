import { EdgeDevice, Time, Warning } from "@carbon/icons-react";

import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import {
  isAsleep,
  STOPPED_AVATAR_CLASS,
} from "../../agents/components/avatar/agent-avatar.js";
import { LazyRobotHead } from "../../agents/components/avatar/lazy-robot-head.js";
import { useAgentAvatars } from "../../agents/hooks/use-agent-avatars.js";
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

function rowIcon(kind: RowKind, size = 16) {
  switch (kind) {
    case "schedule":
      return <Time size={size} />;
    case "slack":
      return (
        <img
          src="/icons/slack.svg"
          alt=""
          style={{ width: size, height: size }}
        />
      );
    case "telegram":
      return (
        <img
          src="/icons/telegram.svg"
          alt=""
          style={{ width: size, height: size }}
        />
      );
    case "approval":
      return <Warning size={size} />;
    default:
      return <EdgeDevice size={size} />;
  }
}

function RowIdentity({
  kind,
  avatarName,
  sleeping,
  stopped,
}: {
  kind: RowKind;
  avatarName: string | undefined;
  sleeping: boolean;
  stopped: boolean;
}) {
  if (avatarName === undefined) {
    return (
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-xl",
          ICON_TINT[kind],
        )}
      >
        {rowIcon(kind)}
      </div>
    );
  }
  return (
    <div className="relative size-10">
      <LazyRobotHead
        name={avatarName}
        size={46}
        sleeping={sleeping || stopped}
        className={cn("-m-[3px]", stopped && STOPPED_AVATAR_CLASS)}
      />
      {kind !== "agent" && (
        <span
          className={cn(
            "absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full ring-2 ring-background",
            ICON_TINT[kind],
          )}
        >
          {rowIcon(kind, 11)}
        </span>
      )}
    </div>
  );
}

export function NotificationRow({
  item,
  agentName,
  avatarName,
  agents,
  meta,
  artifacts,
  onOpen,
  onDismiss,
  onOpenArtifact,
}: {
  item: Extract<FeedItem, { kind: "unread" | "in-progress" }>;
  agentName: string;
  avatarName: string | undefined;
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
  const avatars = useAgentAvatars() && avatarName !== undefined;
  const agent = agents.find((a) => a.id === item.agentId);
  const sleeping = isAsleep(agent?.state);
  const stopped = agent?.stopRequested ?? false;

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
        <RowIdentity
          kind={kind}
          avatarName={avatars ? avatarName : undefined}
          sleeping={sleeping}
          stopped={stopped}
        />
        {running && (
          <span
            className={cn(
              "working-dots absolute top-0 flex items-center -space-x-[1px]",
              avatars ? "-left-[15px]" : "-left-[8px]",
            )}
          >
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
          </span>
        )}
        {unread && !running && (
          <span
            className={cn(
              "absolute top-0 size-2.5 rounded-full border-2 border-background bg-accent",
              avatars ? "-left-2.5" : "-left-0.5",
            )}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="min-w-0 truncate text-sm leading-snug">
          <span className={cn("text-foreground", !running && "font-semibold")}>
            {agentName}
          </span>
          <span className="text-muted-foreground">
            {" "}
            {item.session.title ?? "Session"}
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

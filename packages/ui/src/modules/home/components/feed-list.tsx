import { EdgeDevice, Time } from "@carbon/icons-react";

import { useNow } from "@/hooks/use-now";

import { timeAgo } from "../../../lib/format-time.js";
import type { AgentView } from "../../../types.js";
import type { FeedItem } from "../lib/feed-item.js";
import { NotificationApprovalRow } from "./notification-approval-row.js";
import { NotificationRow } from "./notification-row.js";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const COARSE_TICK_MS = 5 * MINUTE_MS;

interface Props {
  items: readonly FeedItem[];
  agents: readonly AgentView[];
  onOpenSession: (agentId: string, sessionId: string) => void;
  onDismiss: (item: FeedItem) => void;
  onResolved: (item: FeedItem, label: string) => void;
  resolvedLabelFor: (id: string) => string | null;
  onArtifactClick?: (artifactId: string) => void;
}

type ChannelKind = "agent" | "slack" | "telegram" | "schedule";

function channelKindFor(
  item: Extract<FeedItem, { kind: "unread" | "in-progress" }>,
  agents: readonly AgentView[],
): ChannelKind {
  if (item.session.scheduleId) return "schedule";
  if (item.session.threadTs) return "slack";
  const agent = agents.find((a) => a.id === item.agentId);
  if (agent?.channels.some((c) => c.type === "slack")) return "slack";
  return "agent";
}

function channelIcon(kind: ChannelKind) {
  switch (kind) {
    case "schedule":
      return <Time size={16} />;
    case "slack":
      return <img src="/icons/slack.svg" alt="Slack" className="size-4" />;
    case "telegram":
      return (
        <img src="/icons/telegram.svg" alt="Telegram" className="size-4" />
      );
    case "agent":
      return <EdgeDevice size={16} />;
  }
}

function tickFor(items: readonly FeedItem[], from: number): number {
  const youngest = items.reduce((min, item) => {
    if (!item.at) return min;
    return Math.min(min, from - Date.parse(item.at));
  }, Infinity);
  return youngest < HOUR_MS ? MINUTE_MS : COARSE_TICK_MS;
}

export function FeedList({
  items,
  agents,
  onOpenSession,
  onDismiss,
  onResolved,
  resolvedLabelFor,
  onArtifactClick,
}: Props) {
  const tick = tickFor(items, Date.now());
  const now = useNow(tick);

  const nameOf = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.name ?? agentId;

  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => {
        const meta = item.at ? timeAgo(item.at, now) : "—";
        if (item.kind === "approval") {
          return (
            <NotificationApprovalRow
              key={item.id}
              approval={item.approval}
              agentName={nameOf(item.agentId)}
              meta={meta}
              onDismiss={() => onDismiss(item)}
              resolvedLabel={resolvedLabelFor(item.id)}
              onResolved={(label) => onResolved(item, label)}
            />
          );
        }
        const session = item.session;
        const kind = channelKindFor(item, agents);
        return (
          <NotificationRow
            key={item.id}
            channelIcon={channelIcon(kind)}
            channelKind={kind}
            agentName={nameOf(item.agentId)}
            action={session.title ?? "Session"}
            meta={meta}
            working={item.kind === "in-progress"}
            unread={item.kind === "unread"}
            artifact={item.artifact ? { name: item.artifact.name } : undefined}
            onOpen={() => onOpenSession(item.agentId, session.sessionId)}
            onDismiss={
              item.kind === "unread" ? () => onDismiss(item) : undefined
            }
            onArtifactClick={
              item.artifact && onArtifactClick
                ? () => onArtifactClick(item.artifact!.artifactId)
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

import type { SessionMode } from "api-server-api";

import { useNow } from "@/hooks/use-now";

import { timeAgo } from "../../../lib/format-time.js";
import type { AgentView } from "../../../types.js";
import type { ArtifactTouched } from "../api/queries.js";
import type { FeedItem } from "../lib/feed-item.js";
import { FeedApprovalCard } from "./feed-approval-card.js";
import { NotificationRow } from "./notification-row.js";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const COARSE_TICK_MS = 5 * MINUTE_MS;

interface Props {
  items: readonly FeedItem[];
  agents: readonly AgentView[];
  onOpenSession: (
    agentId: string,
    sessionId: string,
    mode: SessionMode,
  ) => void;
  onDismiss: (item: FeedItem) => void;
  onResolved: (item: FeedItem, label: string) => void;
  resolvedLabelFor: (id: string) => string | null;
  artifactsFor: (item: FeedItem) => readonly ArtifactTouched[];
  onOpenArtifact: (artifactId: string) => void;
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
  artifactsFor,
  onOpenArtifact,
}: Props) {
  const tick = tickFor(items, Date.now());
  const now = useNow(tick);

  const nameOf = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.name ?? agentId;
  const avatarOf = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.avatar ?? agentId;

  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => {
        const meta = item.at ? timeAgo(item.at, now) : "—";
        if (item.kind === "approval") {
          return (
            <FeedApprovalCard
              key={item.id}
              approval={item.approval}
              agentName={nameOf(item.agentId)}
              agentAvatar={avatarOf(item.agentId)}
              meta={meta}
              onDismiss={() => onDismiss(item)}
              resolvedLabel={resolvedLabelFor(item.id)}
              onResolved={(label) => onResolved(item, label)}
            />
          );
        }
        return (
          <NotificationRow
            key={item.id}
            item={item}
            agents={agents}
            agentName={nameOf(item.agentId)}
            agentAvatar={avatarOf(item.agentId)}
            meta={meta}
            artifacts={artifactsFor(item)}
            onOpen={() =>
              onOpenSession(
                item.agentId,
                item.session.sessionId,
                item.session.mode,
              )
            }
            onDismiss={
              item.kind === "unread" ? () => onDismiss(item) : undefined
            }
            onOpenArtifact={onOpenArtifact}
          />
        );
      })}
    </div>
  );
}

import { Chemistry, Code, Time } from "@carbon/icons-react";

import { useNow } from "@/hooks/use-now";

import { timeAgo } from "../../../lib/format-time.js";
import type { AgentView } from "../../../types.js";
import type { FeedItem } from "../lib/feed-item.js";
import { FeedApprovalCard } from "./feed-approval-card.js";
import { FeedCard } from "./feed-card.js";

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
}

function sessionIcon(
  item: Extract<FeedItem, { kind: "unread" | "in-progress" }>,
) {
  if (item.session.scheduleId) return <Time size={16} className="shrink-0" />;
  if (item.session.experimentId)
    return <Chemistry size={16} className="shrink-0" />;
  return <Code size={16} className="shrink-0" />;
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
}: Props) {
  const tick = tickFor(items, Date.now());
  const now = useNow(tick);

  const nameOf = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.name ?? agentId;

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const meta = item.at ? timeAgo(item.at, now) : "—";
        if (item.kind === "approval") {
          return (
            <FeedApprovalCard
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
        return (
          <FeedCard
            key={item.id}
            icon={sessionIcon(item)}
            agentName={nameOf(item.agentId)}
            title={session.title ?? "Session"}
            meta={meta}
            working={item.kind === "in-progress"}
            unread={item.kind === "unread"}
            onOpen={() => onOpenSession(item.agentId, session.sessionId)}
            onDismiss={
              item.kind === "unread" ? () => onDismiss(item) : undefined
            }
          />
        );
      })}
    </div>
  );
}

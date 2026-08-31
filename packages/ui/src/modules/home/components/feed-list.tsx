import { Chemistry, Code, Time } from "@carbon/icons-react";

import { SectionLabel } from "@/components/ui/section-label";
import { useNow } from "@/hooks/use-now";
import { clockOf } from "@/lib/format-time";

import type { AgentView } from "../../../types.js";
import { bucketItems } from "../lib/feed-buckets.js";
import type { FeedItem } from "../lib/feed-item.js";
import { type FeedEntry,groupScheduleRuns } from "../lib/schedule-groups.js";
import { FeedCard } from "./feed-card.js";
import { ScheduleGroupCard } from "./schedule-group-card.js";

const MINUTE_MS = 60_000;

interface Props {
  items: readonly FeedItem[];
  agents: readonly AgentView[];
  onOpenSession: (agentId: string, sessionId: string) => void;
  onDismiss: (item: FeedItem) => void;
}

function sessionIcon(item: FeedItem) {
  if (item.session.scheduleId) return <Time size={16} className="shrink-0" />;
  if (item.session.experimentId)
    return <Chemistry size={16} className="shrink-0" />;
  return <Code size={16} className="shrink-0" />;
}

function renderEntry(
  entry: FeedEntry,
  nameOf: (agentId: string) => string,
  now: Date,
  onOpenSession: (agentId: string, sessionId: string) => void,
  onDismiss: (item: FeedItem) => void,
): React.ReactNode {
  if (entry.type === "schedule-group") {
    return (
      <ScheduleGroupCard
        key={`group:${entry.scheduleId}`}
        scheduleId={entry.scheduleId}
        items={entry.items}
        latest={entry.latest}
        now={now}
      />
    );
  }

  const item = entry.item;
  const session = item.session;
  return (
    <FeedCard
      key={item.id}
      icon={sessionIcon(item)}
      agentName={nameOf(item.agentId)}
      title={session.title ?? "Session"}
      meta={clockOf(item.at)}
      working={item.kind === "in-progress"}
      unread={item.kind === "unread"}
      onOpen={() => onOpenSession(item.agentId, session.sessionId)}
      onDismiss={item.kind === "unread" ? () => onDismiss(item) : undefined}
    />
  );
}

export function FeedList({ items, agents, onOpenSession, onDismiss }: Props) {
  const now = useNow(MINUTE_MS);
  const nameOf = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.name ?? agentId;

  const buckets = bucketItems(items, (item) => item.at, now);

  return (
    <div className="flex flex-col gap-5">
      {buckets.map(({ bucket, items: bucketItems }) => {
        const entries = groupScheduleRuns(bucketItems);
        return (
          <div key={bucket} data-bucket={bucket}>
            <div className="flex items-baseline gap-2 pt-1 pb-3">
              <SectionLabel>{bucket}</SectionLabel>
            </div>
            <div className="flex flex-col gap-3">
              {entries.map((entry) =>
                renderEntry(entry, nameOf, now, onOpenSession, onDismiss),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

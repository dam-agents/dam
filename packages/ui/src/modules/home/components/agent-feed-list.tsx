import { Chemistry, Code, Time } from "@carbon/icons-react";

import { SectionLabel } from "@/components/ui/section-label";
import { useNow } from "@/hooks/use-now";
import { clockOf, timeAgo } from "@/lib/format-time";

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { WorkingDots } from "../../sessions/components/working-dots.js";
import { bucketItems } from "../lib/feed-buckets.js";
import type { FeedItem } from "../lib/feed-item.js";
import { type FeedEntry,groupScheduleRuns } from "../lib/schedule-groups.js";

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

function SessionRow({
  item,
  onOpen,
  onDismiss,
}: {
  item: FeedItem;
  onOpen: () => void;
  onDismiss?: () => void;
}) {
  const working = item.kind === "in-progress";
  const unread = item.kind === "unread";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
    >
      <span className="text-muted-foreground">{sessionIcon(item)}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {item.session.title ?? "Session"}
        {working && (
          <WorkingDots
            className="ml-1 inline-flex align-middle text-accent"
            size="md"
          />
        )}
        {unread && !working && (
          <span className="ml-1.5 inline-block size-2 rounded-full bg-accent align-middle" />
        )}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
        {clockOf(item.at)}
      </span>
      {onDismiss && (
        <button
          type="button"
          className="shrink-0 text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

function ScheduleGroupRow({
  items,
  latest,
  now,
}: {
  items: readonly FeedItem[];
  latest: FeedItem;
  now: Date;
}) {
  const title = latest.session.title ?? "Scheduled run";
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
      <span className="text-muted-foreground">
        <Time size={16} className="shrink-0" />
      </span>
      <span className="min-w-0 flex-1 text-sm text-muted-foreground">
        {title}
        <span className="mx-1">&middot;</span>
        {items.length} runs &middot; latest {timeAgo(latest.at, now)}
      </span>
    </div>
  );
}

function renderEntry(
  entry: FeedEntry,
  now: Date,
  onOpenSession: (agentId: string, sessionId: string) => void,
  onDismiss: (item: FeedItem) => void,
): React.ReactNode {
  if (entry.type === "schedule-group") {
    return (
      <ScheduleGroupRow
        key={`group:${entry.scheduleId}`}
        items={entry.items}
        latest={entry.latest}
        now={now}
      />
    );
  }

  const item = entry.item;
  return (
    <SessionRow
      key={item.id}
      item={item}
      onOpen={() => onOpenSession(item.agentId, item.session.sessionId)}
      onDismiss={item.kind === "unread" ? () => onDismiss(item) : undefined}
    />
  );
}

function AgentCard({
  agent,
  items,
  now,
  onOpenSession,
  onDismiss,
}: {
  agent: AgentView;
  items: readonly FeedItem[];
  now: Date;
  onOpenSession: (agentId: string, sessionId: string) => void;
  onDismiss: (item: FeedItem) => void;
}) {
  const entries = groupScheduleRuns(items);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-medium text-foreground">{agent.name}</p>
        <StatusBadge state={agent.overBudget ? "over_budget" : agent.state} />
      </div>
      <div className="mt-2 border-t border-border/50 pt-2">
        <div className="-mx-1 flex flex-col">
          {entries.map((entry) =>
            renderEntry(entry, now, onOpenSession, onDismiss),
          )}
        </div>
      </div>
    </div>
  );
}

export function AgentFeedList({
  items,
  agents,
  onOpenSession,
  onDismiss,
}: Props) {
  const now = useNow(MINUTE_MS);
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const buckets = bucketItems(items, (item) => item.at, now);

  return (
    <div className="flex flex-col gap-6">
      {buckets.map(({ bucket, items: bucketItems }) => {
        const byAgent = new Map<string, FeedItem[]>();
        for (const item of bucketItems) {
          let arr = byAgent.get(item.agentId);
          if (!arr) {
            arr = [];
            byAgent.set(item.agentId, arr);
          }
          arr.push(item);
        }

        return (
          <div key={bucket}>
            <div className="flex items-baseline gap-2 pt-1 pb-3">
              <SectionLabel>{bucket}</SectionLabel>
            </div>
            <div className="flex flex-col gap-3">
              {[...byAgent.entries()].map(([agentId, agentItems]) => {
                const agent = agentMap.get(agentId);
                if (!agent) return null;
                return (
                  <AgentCard
                    key={agentId}
                    agent={agent}
                    items={agentItems}
                    now={now}
                    onOpenSession={onOpenSession}
                    onDismiss={onDismiss}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

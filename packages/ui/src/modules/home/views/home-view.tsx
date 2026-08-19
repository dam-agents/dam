import { useState } from "react";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { WelcomeEntryPoints } from "../../agents/components/welcome-entry-points.js";
import { useMarkSessionsSeen } from "../api/mutations.js";
import { useFeed } from "../api/queries.js";
import { FeedEmptyState } from "../components/feed-empty-state.js";
import { FeedFilterBar } from "../components/feed-filter-bar.js";
import { FeedList } from "../components/feed-list.js";
import { HomeGreeting } from "../components/home-greeting.js";
import {
  emptyStateFor,
  FEED_SOURCES,
  type FeedSource,
  feedStats,
  type FeedStatus,
  filterFeed,
} from "../lib/feed-filter.js";

export function HomeView() {
  const {
    items,
    agents,
    runningAgents,
    hasAgents,
    loadingAgents,
    loadingApprovals,
  } = useFeed();
  const openAgentSession = useStore((s) => s.openAgentSession);
  const markSeen = useMarkSessionsSeen();

  const [status, setStatus] = useState<FeedStatus>("all");
  const [included, setIncluded] = useState<ReadonlySet<FeedSource>>(
    () => new Set(FEED_SOURCES),
  );

  if (loadingAgents) {
    return (
      <div>
        <HomeGreeting title="Activity" />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <ListSkeleton rows={3} rowHeight={126} />
          <aside />
        </div>
      </div>
    );
  }

  if (!hasAgents) {
    return (
      <div>
        <HomeGreeting title="Welcome" />
        <WelcomeEntryPoints />
      </div>
    );
  }

  const visible = filterFeed(items, status, included);
  const stats = feedStats(visible);
  const dismissible = visible.filter((item) => item.kind === "unread");

  const toggleSource = (source: FeedSource) =>
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });

  return (
    <div>
      <HomeGreeting title="Activity" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-1">
            <FeedFilterBar
              status={status}
              onStatusChange={setStatus}
              included={included}
              onToggleSource={toggleSource}
            />
            {stats.running + stats.toReview > 0 && (
              <div className="flex items-center gap-4">
                <p className="text-sm text-muted-foreground tabular-nums">
                  <span className="font-medium text-foreground">
                    {stats.running}
                  </span>{" "}
                  running
                  <span className="mx-1.5 text-border">·</span>
                  <span className="font-medium text-foreground">
                    {stats.toReview}
                  </span>{" "}
                  to review
                </p>
                {dismissible.length > 0 && (
                  <button
                    type="button"
                    disabled={markSeen.isPending}
                    onClick={() =>
                      markSeen.mutate(
                        dismissible.map((item) => ({
                          agentId: item.agentId,
                          sessionId: item.session.sessionId,
                        })),
                      )
                    }
                    title="Marks unread items read. Approvals and running work stay."
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>
          {loadingApprovals && items.length === 0 ? (
            <ListSkeleton rows={3} rowHeight={116} />
          ) : visible.length > 0 ? (
            <FeedList
              items={visible}
              agents={agents}
              onOpenSession={openAgentSession}
              onDismissUnread={(agentId, sessionId) =>
                markSeen.mutate([{ agentId, sessionId }])
              }
            />
          ) : (
            <FeedEmptyState
              {...emptyStateFor(status, {
                allSourcesExcluded: included.size === 0,
                noRunningAgents: runningAgents.length === 0,
              })}
            />
          )}
        </div>
        <aside />
      </div>
    </div>
  );
}

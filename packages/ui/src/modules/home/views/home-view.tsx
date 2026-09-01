import { useState } from "react";

import { useStore } from "../../../store.js";
import { WelcomeEntryPoints } from "../../agents/components/welcome-entry-points.js";
import { useFeed } from "../api/queries.js";
import { ComputeWidget } from "../components/compute-widget.js";
import { FeedCardSkeleton } from "../components/feed-card-skeleton.js";
import { FeedEmptyState } from "../components/feed-empty-state.js";
import { FeedFilterBar } from "../components/feed-filter-bar.js";
import { FeedList } from "../components/feed-list.js";
import { HomeGreeting } from "../components/home-greeting.js";
import {
  FeedFilterSkeleton,
  WidgetSkeleton,
} from "../components/home-skeletons.js";
import { SchedulesWidget } from "../components/schedules-widget.js";
import { SpendWidget } from "../components/spend-widget.js";
import { useDismissals } from "../hooks/use-dismissals.js";
import { usePodSessionsWatch } from "../hooks/use-pod-sessions-watch.js";
import { useStickyResolved } from "../hooks/use-sticky-resolved.js";
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
    loadingFeed,
    unreadableAgents,
    approvalsUnreadable,
  } = useFeed();
  usePodSessionsWatch();
  const openAgentSession = useStore((s) => s.openAgentSession);
  const { isDismissed, dismiss } = useDismissals();
  const sticky = useStickyResolved();

  const [status, setStatus] = useState<FeedStatus>("all");
  const [included, setIncluded] = useState<ReadonlySet<FeedSource>>(
    () => new Set(FEED_SOURCES),
  );

  if (loadingAgents) {
    return (
      <div>
        <HomeGreeting title="Activity" />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex items-center justify-between lg:col-start-1 lg:row-start-1">
            <FeedFilterSkeleton />
          </div>
          <div className="space-y-3 lg:col-start-1 lg:row-start-2">
            <FeedCardSkeleton rows={3} />
          </div>
          <aside className="space-y-4 lg:col-start-2 lg:row-start-2">
            <WidgetSkeleton rows={2} />
            <WidgetSkeleton rows={3} />
            <WidgetSkeleton rows={3} />
          </aside>
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

  const live = sticky.merge(items).filter((item) => !isDismissed(item));
  const visible = filterFeed(live, status, included);
  const stats = feedStats(visible);
  const dismissible = visible.filter((item) => item.kind !== "in-progress");
  const workingAgentIds = new Set(
    live.filter((i) => i.kind === "in-progress").map((i) => i.agentId),
  );

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
        <div className="flex items-center justify-between lg:col-start-1 lg:row-start-1">
          <div className="flex w-full items-center justify-between">
            <FeedFilterBar
              status={status}
              onStatusChange={setStatus}
              included={included}
              onToggleSource={toggleSource}
            />
            {(stats.running + stats.toReview > 0 || dismissible.length > 0) && (
              <div className="flex items-center gap-4">
                {stats.running + stats.toReview > 0 && (
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
                )}
                {dismissible.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      for (const item of dismissible) sticky.drop(item.id);
                      dismiss(dismissible);
                    }}
                    title="Hides these from Home. Nothing is resolved or marked read; running work stays."
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="space-y-3 lg:col-start-1 lg:row-start-2">
          {loadingFeed && visible.length === 0 ? (
            <FeedCardSkeleton rows={3} />
          ) : visible.length === 0 ? (
            <FeedEmptyState
              {...emptyStateFor(status, {
                allSourcesExcluded: included.size === 0,
                noRunningAgents: runningAgents.length === 0,
                unreadableAgents,
                approvalsUnreadable,
              })}
            />
          ) : (
            <>
              {loadingFeed && <FeedCardSkeleton />}
              <FeedList
                items={visible}
                agents={agents}
                onOpenSession={openAgentSession}
                onDismiss={(item) => {
                  sticky.drop(item.id);
                  dismiss([item]);
                }}
                onResolved={(item, label) => sticky.keep(item, label)}
                resolvedLabelFor={sticky.labelFor}
              />
            </>
          )}
        </div>
        <aside className="space-y-4 lg:col-start-2 lg:row-start-2">
          <ComputeWidget
            runningAgents={runningAgents}
            workingAgentIds={workingAgentIds}
          />
          <SpendWidget />
          <SchedulesWidget />
        </aside>
      </div>
    </div>
  );
}

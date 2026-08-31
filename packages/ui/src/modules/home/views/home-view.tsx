import { useState } from "react";

import { useStore } from "../../../store.js";
import { WelcomeEntryPoints } from "../../agents/components/welcome-entry-points.js";
import type { SessionCategory } from "../../sessions/lib/session-category.js";
import { useFeed } from "../api/queries.js";
import { AgentFeedList } from "../components/agent-feed-list.js";
import { ApprovalSummaryRow } from "../components/approval-summary-row.js";
import { ApprovalsDetailPage } from "../components/approvals-detail-page.js";
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
import { type HomeLayout,LayoutToggle } from "../components/layout-toggle.js";
import { SchedulesWidget } from "../components/schedules-widget.js";
import { SpendWidget } from "../components/spend-widget.js";
import { WidgetBanner } from "../components/widget-banner.js";
import { useDismissals } from "../hooks/use-dismissals.js";
import { usePodSessionsWatch } from "../hooks/use-pod-sessions-watch.js";
import { useStickyResolved } from "../hooks/use-sticky-resolved.js";
import { approvalDismissalKey } from "../lib/dismissals.js";
import {
  ALL_CATEGORIES,
  ALL_STATES,
  emptyStateFor,
  type FeedState,
  feedStats,
  filterFeed,
} from "../lib/feed-filter.js";

type Page = "feed" | "approvals";

export function HomeView() {
  const {
    items,
    approvals,
    pendingApprovals,
    agents,
    runningAgents,
    hasAgents,
    loadingAgents,
    loadingFeed,
    unreadableAgents,
  } = useFeed();
  usePodSessionsWatch();
  const openAgentSession = useStore((s) => s.openAgentSession);
  const dismissedKeys = useStore((s) => s.dismissedKeys);
  const dismissByKey = useStore((s) => s.dismissByKey);
  const { isDismissed, dismiss } = useDismissals();
  const sticky = useStickyResolved();

  const [page, setPage] = useState<Page>("feed");
  const [layout, setLayout] = useState<HomeLayout>("feed");
  const [includedStates, setIncludedStates] = useState<ReadonlySet<FeedState>>(
    () => new Set(ALL_STATES),
  );
  const [includedCategories, setIncludedCategories] = useState<
    ReadonlySet<SessionCategory>
  >(() => new Set(ALL_CATEGORIES));

  const [approvalResolved, setApprovalResolved] = useState<Map<string, string>>(
    () => new Map(),
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

  const visiblePendingApprovals = pendingApprovals.filter(
    (a) => !dismissedKeys.has(approvalDismissalKey(a)),
  );

  if (page === "approvals") {
    return (
      <div>
        <HomeGreeting title="Activity" />
        <ApprovalsDetailPage
          approvals={approvals}
          agents={agents}
          dismissed={dismissedKeys as ReadonlySet<string>}
          onDismiss={dismissByKey}
          onBack={() => setPage("feed")}
          resolvedLabelFor={(id) => approvalResolved.get(id) ?? null}
          onResolved={(id, label) =>
            setApprovalResolved((prev) => new Map(prev).set(id, label))
          }
        />
      </div>
    );
  }

  const live = sticky.merge(items).filter((item) => !isDismissed(item));
  const visible = filterFeed(live, includedStates, includedCategories);
  const stats = feedStats(visible);
  const dismissible = visible.filter((item) => item.kind !== "in-progress");
  const workingAgentIds = new Set(
    live.filter((i) => i.kind === "in-progress").map((i) => i.agentId),
  );

  const toggleState = (state: FeedState) =>
    setIncludedStates((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });

  const toggleCategory = (cat: SessionCategory) =>
    setIncludedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const toggleAll = () => {
    const allOn =
      includedStates.size === ALL_STATES.size &&
      includedCategories.size === ALL_CATEGORIES.size;
    if (allOn) {
      setIncludedStates(new Set());
      setIncludedCategories(new Set());
    } else {
      setIncludedStates(new Set(ALL_STATES));
      setIncludedCategories(new Set(ALL_CATEGORIES));
    }
  };

  const filterRow = (
    <div className="flex w-full items-center justify-between">
      <FeedFilterBar
        includedStates={includedStates}
        includedCategories={includedCategories}
        onToggleState={toggleState}
        onToggleCategory={toggleCategory}
        onToggleAll={toggleAll}
      />
      {(stats.running + stats.toReview > 0 || dismissible.length > 0) && (
        <div className="flex items-center gap-4">
          {stats.running + stats.toReview > 0 && (
            <p className="text-sm text-muted-foreground tabular-nums">
              <span className="font-medium text-foreground">
                {stats.running}
              </span>{" "}
              running
              <span className="mx-1.5 text-border">&middot;</span>
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
  );

  const feedContent =
    loadingFeed && visible.length === 0 ? (
      <FeedCardSkeleton rows={3} />
    ) : visible.length === 0 ? (
      <FeedEmptyState
        {...emptyStateFor({
          allStatesExcluded: includedStates.size === 0,
          allCategoriesExcluded: includedCategories.size === 0,
          noRunningAgents: runningAgents.length === 0,
          unreadableAgents,
        })}
      />
    ) : null;

  if (layout === "combined") {
    return (
      <div>
        <div className="flex items-end justify-between pb-10">
          <HomeGreeting title="Activity" />
          <LayoutToggle value={layout} onChange={setLayout} />
        </div>
        <div className="flex flex-col gap-4">
          <WidgetBanner
            runningAgents={runningAgents}
            workingAgentIds={workingAgentIds}
          />
          <ApprovalSummaryRow
            pendingCount={visiblePendingApprovals.length}
            onClick={() => setPage("approvals")}
          />
          {filterRow}
          <div className="space-y-3">
            {feedContent ?? (
              <>
                {loadingFeed && <FeedCardSkeleton />}
                <AgentFeedList
                  items={visible}
                  agents={agents}
                  onOpenSession={openAgentSession}
                  onDismiss={(item) => {
                    sticky.drop(item.id);
                    dismiss([item]);
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <HomeGreeting title="Activity" />
        <div className="pt-8">
          <LayoutToggle value={layout} onChange={setLayout} />
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-1">
          {filterRow}
          <ApprovalSummaryRow
            pendingCount={visiblePendingApprovals.length}
            onClick={() => setPage("approvals")}
          />
        </div>
        <div className="space-y-3 lg:col-start-1 lg:row-start-2">
          {feedContent ?? (
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

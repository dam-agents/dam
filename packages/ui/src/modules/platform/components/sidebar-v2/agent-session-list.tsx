import { useEffect, useRef, useState } from "react";

import { useStore } from "../../../../store.js";
import { useAgentRunState } from "../../../agents/api/queries.js";
import { isFiltered } from "../../../home/lib/activity-filter.js";
import { matchesActivityFilters } from "../../../home/lib/activity-sessions.js";
import { SessionListSkeleton } from "../../../sessions/components/session-list-skeleton.js";
import { useAgentSessionList } from "../../../sessions/hooks/use-agent-session-list.js";
import {
  pinKey,
  usePinnedSessions,
} from "../../../sessions/lib/pinned-sessions.js";
import { newestFirst } from "../../../sessions/lib/sidebar-session-window.js";
import { splitPinned } from "../../lib/sidebar-tree.js";
import { RetryRow } from "./add-row.js";
import { TreeSessionRow } from "./tree-session-row.js";

function useAgentTreeRows(agentId: string) {
  const list = useAgentSessionList(agentId);
  const filters = useStore((s) => s.sidebarActivityFilters);
  const pins = usePinnedSessions();
  const rows = newestFirst(
    list.sessions
      .map((session) => ({ session, state: list.rowState(session) }))
      .filter(({ session, state }) =>
        matchesActivityFilters(
          {
            session,
            working: state.working,
            unread: state.unread,
            needsApproval: state.needsApproval,
          },
          filters,
        ),
      ),
    (row) => row.session.updatedAt ?? row.session.createdAt,
    (row) => row.session.sessionId,
  );
  const [pinned, rest] = splitPinned(rows, (row) =>
    pins.has(pinKey(agentId, row.session.sessionId)),
  );
  return { list, filters, pins, rows, pinned, rest };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One Agent's Sessions, nested under the Agent in the new layout's sidebar tree: every Session the Agent lists except its pinned ones, which the Pinned section above shows, the next page loaded when the list scrolls near its end, and the Sessions ordered by last activity, newest first. A hibernated Agent whose record holds no Session says its Sessions show when it wakes.
 */
export function AgentSessionList({
  agentId,
  onNavigate,
}: {
  agentId: string;
  onNavigate?: () => void;
}) {
  const { list, filters, rows, rest } = useAgentTreeRows(agentId);
  const runState = useAgentRunState(agentId);
  const asleep =
    list.loading &&
    list.recordRead &&
    (runState === "hibernated" || runState === "hibernating");
  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPageFailed,
    fetchNextPage,
  } = list;
  const [retryingNext, setRetryingNext] = useState(false);
  const canFetch = hasNextPage && !isFetchingNextPage && !fetchNextPageFailed;
  const endRef = useLoadOnReach(canFetch, () => void fetchNextPage());

  return (
    <div
      className="flex flex-col gap-px pb-1"
      data-testid="sidebar-agent-sessions"
      data-provisional={list.provisional ? "true" : undefined}
      aria-busy={list.provisional || (list.loading && !asleep && !list.failed)}
    >
      {asleep ? (
        <p
          className="py-1.5 pl-2 text-xs text-muted-foreground"
          data-testid="sidebar-agent-asleep"
        >
          Its sessions show when it wakes.
        </p>
      ) : (
        list.loading && !list.failed && <SessionListSkeleton />
      )}
      {list.failed && (
        <RetryRow
          label="Couldn't load sessions."
          testId="sidebar-agent-sessions-failed"
          retrying={list.retrying}
          onRetry={() => void list.retry()}
        />
      )}
      {!list.loading && !list.failed && rows.length === 0 && !hasNextPage && (
        <p className="py-1.5 pl-2 text-xs text-muted-foreground">
          {isFiltered(filters)
            ? "No sessions match the filter."
            : "No sessions yet."}
        </p>
      )}
      {rest.map(({ session, state }) => (
        <TreeSessionRow
          key={session.sessionId}
          agentId={agentId}
          session={session}
          state={state}
          operable={list.operable}
          pinned={false}
          onNavigate={onNavigate}
        />
      ))}
      {hasNextPage && <div ref={endRef} aria-hidden className="h-px" />}
      {isFetchingNextPage && !retryingNext && <SessionListSkeleton />}
      {hasNextPage && (fetchNextPageFailed || retryingNext) && (
        <RetryRow
          label="Couldn't load the rest."
          testId="sidebar-agent-sessions-more-failed"
          retrying={retryingNext}
          onRetry={() => {
            setRetryingNext(true);
            void fetchNextPage().finally(() => setRetryingNext(false));
          }}
        />
      )}
    </div>
  );
}

function useLoadOnReach(enabled: boolean, load: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && loadRef.current(),
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}

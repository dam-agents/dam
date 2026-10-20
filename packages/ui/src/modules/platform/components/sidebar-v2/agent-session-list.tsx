import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

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
import { FOCUS_RING } from "./add-row.js";
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
          { session, working: state.working, unread: state.unread },
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
  const canFetch = hasNextPage && !isFetchingNextPage && !fetchNextPageFailed;
  const endRef = useLoadOnReach(canFetch, () => void fetchNextPage());

  return (
    <div
      className="flex flex-col gap-px pb-1"
      data-testid="sidebar-agent-sessions"
      data-provisional={list.provisional ? "true" : undefined}
      aria-busy={list.provisional || (list.loading && !asleep)}
    >
      {asleep ? (
        <p
          className="py-1.5 pl-2 text-xs text-muted-foreground"
          data-testid="sidebar-agent-asleep"
        >
          Its sessions show when it wakes.
        </p>
      ) : (
        list.loading && <SessionListSkeleton />
      )}
      {!list.loading && rows.length === 0 && !hasNextPage && (
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
      {isFetchingNextPage && <SessionListSkeleton />}
      {hasNextPage && fetchNextPageFailed && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          className={cn(
            "flex h-[30px] items-center rounded-lg pl-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            FOCUS_RING,
          )}
        >
          Couldn't load the rest. Retry
        </button>
      )}
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The pinned Sessions of one Agent that the owner's bounded attention feed does not hold, read from the Agent's own list for the Pinned section. It loads further pages until every such pin appears. A pin whose Session is gone shows nowhere and stays in storage: pins live only in this browser, so no failed or stale list may drop one.
 */
export function AgentPinnedRows({
  agentId,
  agentName,
  inFeed,
  onNavigate,
}: {
  agentId: string;
  agentName: string;
  inFeed: ReadonlySet<string>;
  onNavigate?: () => void;
}) {
  const { list, pins, pinned } = useAgentTreeRows(agentId);
  const loaded = new Set(
    list.sessions.map((s) => pinKey(agentId, s.sessionId)),
  );
  const missing = [...pins].filter(
    (key) =>
      key.startsWith(`${agentId}:`) && !inFeed.has(key) && !loaded.has(key),
  );
  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPageFailed,
    fetchNextPage,
  } = list;
  const chase =
    missing.length > 0 &&
    hasNextPage &&
    !isFetchingNextPage &&
    !fetchNextPageFailed &&
    !list.provisional;
  useEffect(() => {
    if (chase) void fetchNextPage();
  }, [chase, fetchNextPage]);

  return pinned
    .filter(({ session }) => !inFeed.has(pinKey(agentId, session.sessionId)))
    .map(({ session, state }) => (
      <TreeSessionRow
        key={session.sessionId}
        agentId={agentId}
        session={session}
        state={state}
        operable={list.operable}
        pinned
        prefix={agentName}
        onNavigate={onNavigate}
      />
    ));
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

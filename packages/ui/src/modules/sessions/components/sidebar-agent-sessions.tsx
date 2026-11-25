import { SessionMode } from "api-server-api";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Spinner } from "@/components/ui/spinner";

import type { SessionView } from "../../../types.js";
import {
  type ActivityFilters,
  activityFilterSummary,
  defaultActivityFilters,
  isFiltered,
} from "../../home/lib/activity-filter.js";
import { matchesActivityFilters } from "../../home/lib/activity-sessions.js";
import { prefetchSessionHistory } from "../api/queries.js";
import { useAgentSessionList } from "../hooks/use-agent-session-list.js";
import { useOpenSession } from "../hooks/use-open-session.js";
import {
  type SessionRowActions,
  useSessionRowActions,
} from "../hooks/use-session-row-actions.js";
import {
  setAgentSessionFilter,
  useAgentSessionFilter,
} from "../lib/agent-session-filters.js";
import { SIDEBAR_SESSION_ROW_CLASS } from "../lib/sidebar-session-row.js";
import {
  fillsStep,
  fillState,
  newestFirst,
  SIDEBAR_FILL_PAGES,
  SIDEBAR_SESSION_STEP,
  sidebarSessionWindow,
  viewMore,
} from "../lib/sidebar-session-window.js";
import { RenameSessionDialog } from "./rename-session-dialog.js";
import { SessionListSkeleton } from "./session-list-skeleton.js";
import { SessionRow } from "./session-row.js";

const LIST_CLASS = "flex flex-col gap-1";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Sessions of the Agent the sidebar is
 * narrowed to, read from the Agent's own list: five at first and five more
 * per View more, which then moves focus to the first newly shown Session,
 * also once a provisional list gives way to the Agent's own list or a Retry
 * loads the page that failed. After a View more the list loads further pages
 * until the rows fill the window or the list ends, at most five pages per
 * click before it offers Keep looking; a changed filter starts again at
 * five. The Agent's filter goes with the page request, so the runtime pages
 * matching Sessions only, except Needs attention, which only the browser can
 * tell; the list names the filter and offers to clear it.
 */
export function SidebarAgentSessions({
  agentId,
  onNavigate,
}: {
  agentId: string;
  onNavigate?: () => void;
}) {
  const [limit, setLimit] = useState(SIDEBAR_SESSION_STEP);
  const [focusAfter, setFocusAfter] = useState<ReadonlySet<string> | null>(
    null,
  );
  const [renaming, setRenaming] = useState<SessionView | null>(null);
  const sessionActions = useSessionRowActions(agentId, setRenaming);
  const filter = useAgentSessionFilter(agentId);
  const filtered = !!filter && isFiltered(filter);
  const [limitKey, setLimitKey] = useState({ agentId, filter });
  if (limitKey.agentId !== agentId || limitKey.filter !== filter) {
    setLimitKey({ agentId, filter });
    setLimit(SIDEBAR_SESSION_STEP);
  }

  return (
    <>
      {filtered && (
        <FilterNote
          summary={activityFilterSummary(filter)}
          onClear={() =>
            setAgentSessionFilter(agentId, defaultActivityFilters())
          }
        />
      )}
      <AgentSessionList
        agentId={agentId}
        sessionActions={sessionActions}
        filter={filtered ? filter : undefined}
        limit={limit}
        onLimitChange={setLimit}
        focusAfter={focusAfter}
        onFocusAfterChange={setFocusAfter}
        onNavigate={onNavigate}
      />
      {renaming && (
        <RenameSessionDialog
          agentId={agentId}
          session={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
    </>
  );
}

function AgentSessionList({
  agentId,
  sessionActions,
  filter,
  limit,
  onLimitChange,
  focusAfter,
  onFocusAfterChange,
  onNavigate,
}: {
  agentId: string;
  sessionActions: SessionRowActions;
  filter: ActivityFilters | undefined;
  limit: number;
  onLimitChange: (limit: number) => void;
  focusAfter: ReadonlySet<string> | null;
  onFocusAfterChange: (shown: ReadonlySet<string> | null) => void;
  onNavigate?: () => void;
}) {
  const list = useAgentSessionList(agentId, filter);
  const openSession = useOpenSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pagesLeft, setPagesLeft] = useState(SIDEBAR_FILL_PAGES);

  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPageFailed,
    fetchNextPage,
  } = list;

  const filtered = filter !== undefined;
  const rows = newestFirst(
    list.sessions
      .map((session) => {
        const state = list.rowState(session);
        const matches =
          filter === undefined ||
          matchesActivityFilters(
            {
              session,
              working: state.working,
              unread: state.unread,
              needsApproval: state.needsApproval,
            },
            filter,
          );
        return { session, state, outsideFilter: !matches };
      })
      .filter(({ state, outsideFilter }) => state.active || !outsideFilter),
    (row) => row.session.updatedAt ?? row.session.createdAt,
    (row) => row.session.sessionId,
  );
  const visible = sidebarSessionWindow(rows, limit, (row) => row.state.active);
  const visibleIds = visible.map((row) => row.session.sessionId);
  const next = viewMore({
    total: rows.length,
    shown: visible.length,
    limit,
    hasNextPage,
  });
  const paged = limit > SIDEBAR_SESSION_STEP;
  const filling = fillsStep({
    total: rows.length,
    limit,
    hasNextPage,
    fetchNextPageFailed,
  });
  const fill = fillState({ filling, pagesLeft });

  useEffect(() => {
    if (fill !== "searching" || isFetchingNextPage || list.loading) return;
    setPagesLeft((left) => left - 1);
    void fetchNextPage();
  }, [fill, isFetchingNextPage, list.loading, fetchNextPage]);

  useEffect(() => {
    if (!focusAfter || list.loading || isFetchingNextPage) return;
    const id = visibleIds.find((sessionId) => !focusAfter.has(sessionId));
    const focused = document.activeElement;
    const unclaimed =
      !focused ||
      focused === document.body ||
      !!rootRef.current?.contains(focused);
    if (id && unclaimed)
      rootRef.current
        ?.querySelector<HTMLElement>(
          `[data-session-id="${CSS.escape(id)}"] [data-row-main]`,
        )
        ?.focus();
    const pending =
      list.provisional ||
      list.failed ||
      fetchNextPageFailed ||
      fill === "searching";
    if (id || !unclaimed || !pending) onFocusAfterChange(null);
  });

  return (
    <div
      ref={rootRef}
      className={LIST_CLASS}
      data-testid="sidebar-agent-sessions"
      data-provisional={list.provisional ? "true" : undefined}
      aria-busy={list.provisional || (list.loading && !list.failed)}
    >
      {list.loading && !list.failed && <SessionListSkeleton />}
      {list.failed && (
        <button
          type="button"
          onClick={() => void list.retry()}
          disabled={list.retrying}
          data-testid="sidebar-agent-sessions-failed"
          className={`flex h-[30px] items-center gap-1 rounded-lg pl-3 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
        >
          Couldn't load sessions. Retry
          {list.retrying && <Spinner />}
        </button>
      )}
      {!list.loading &&
        !list.failed &&
        rows.length === 0 &&
        (!hasNextPage || filtered) && (
          <ListNote>{emptyText(filtered, hasNextPage)}</ListNote>
        )}
      {visible.map(({ session: s, state, outsideFilter }) => (
        <SessionRow
          key={s.sessionId}
          session={s}
          {...state}
          outsideFilter={outsideFilter}
          className={SIDEBAR_SESSION_ROW_CLASS}
          onResume={() => {
            openSession(agentId, s.sessionId, s.mode);
            onNavigate?.();
          }}
          {...(list.operable &&
            s.mode !== SessionMode.Terminal && {
              onPrefetch: () => prefetchSessionHistory(agentId, s.sessionId),
            })}
          onRename={() => sessionActions.rename(s)}
          onDelete={() => void sessionActions.delete(s)}
          {...(sessionActions.exportTimeline && {
            onExportTimeline: () => sessionActions.exportTimeline?.(s),
          })}
        />
      ))}
      {paged && hasNextPage && fetchNextPageFailed ? (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          className={`flex h-[30px] items-center rounded-lg pl-3 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
        >
          Couldn't load the rest. Retry
        </button>
      ) : (
        next.more && (
          <ViewMoreRow
            busy={isFetchingNextPage}
            label={
              fill === "searching"
                ? "Looking for more…"
                : fill === "paused"
                  ? "Keep looking"
                  : filtered && rows.length === 0
                    ? "Look further"
                    : "View more"
            }
            onClick={() => {
              onFocusAfterChange(new Set(visibleIds));
              setPagesLeft(SIDEBAR_FILL_PAGES);
              if (fill !== "paused") onLimitChange(next.limit);
            }}
          />
        )
      )}
    </div>
  );
}

function emptyText(filtered: boolean, more: boolean): string {
  if (!filtered) return "No sessions yet.";
  return more
    ? "None of the latest sessions match."
    : "No sessions match the filter.";
}

function ListNote({ children }: { children: ReactNode }) {
  return (
    <p className="py-1.5 pl-3 text-xs text-muted-foreground">{children}</p>
  );
}

function FilterNote({
  summary,
  onClear,
}: {
  summary: string;
  onClear: () => void;
}) {
  return (
    <div
      data-testid="sidebar-agent-filter-note"
      className="flex h-6 min-w-0 items-center gap-2 pr-2 pl-3 text-2xs text-muted-foreground"
    >
      <span className="min-w-0 truncate" title={`Filtered: ${summary}`}>
        Filtered: {summary}
      </span>
      <button
        type="button"
        onClick={onClear}
        data-testid="sidebar-agent-filter-clear"
        className={`shrink-0 rounded-sm underline-offset-2 hover:text-foreground hover:underline ${FOCUS_RING}`}
      >
        Clear filter
      </button>
    </div>
  );
}

function ViewMoreRow({
  busy = false,
  label = "View more",
  onClick,
}: {
  busy?: boolean;
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={busy || undefined}
      data-testid="sidebar-agent-sessions-more"
      className={`flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg pl-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
    >
      {label}
      {busy && <Spinner />}
    </button>
  );
}

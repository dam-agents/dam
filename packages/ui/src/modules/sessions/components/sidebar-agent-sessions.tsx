import {
  type AttentionItem,
  SessionMode,
  TELEMETRY_MAX_SINCE_HOURS,
} from "api-server-api";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useAgentRunState } from "../../agents/api/queries.js";
import { useActWhenAwake } from "../../agents/hooks/use-act-when-awake.js";
import {
  useFeatures,
  useInstallCapabilities,
} from "../../features/api/queries.js";
import type { AgentActivitySession } from "../../home/hooks/use-activity-sessions.js";
import {
  type ActivityFilters,
  isFiltered,
} from "../../home/lib/activity-filter.js";
import { matchesActivityFilters } from "../../home/lib/activity-sessions.js";
import { downloadTelemetryExport } from "../../telemetry/api/download-export.js";
import {
  prefetchSessionHistory,
  provisionalSessionView,
} from "../api/queries.js";
import { useAgentSessionList } from "../hooks/use-agent-session-list.js";
import { useOpenSession } from "../hooks/use-open-session.js";
import { useAgentSessionFilter } from "../lib/agent-session-filters.js";
import { sessionTitleLabel } from "../lib/session-title.js";
import {
  newestFirst,
  SIDEBAR_SESSION_STEP,
  sidebarSessionWindow,
  viewMore,
} from "../lib/sidebar-session-window.js";
import { RenameSessionDialog } from "./rename-session-dialog.js";
import { SessionListSkeleton } from "./session-list-skeleton.js";
import { SessionRow } from "./session-row.js";

const ROW_CLASS = "rounded-lg border-b-0 py-2.5 pr-2 pl-12";
const LIST_CLASS = "mt-2 mb-3 flex flex-col gap-1";

interface SessionActions {
  rename: (session: SessionView) => void;
  delete: (session: SessionView) => Promise<void>;
}

interface Props {
  agentId: string;
  open: boolean;
  preview: readonly AgentActivitySession[];
  previewComplete: boolean;
  conversationOf: (session: AttentionItem) => string | undefined;
  onNavigate?: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent's Sessions under its row in the sidebar,
 * five at first and five more per View more, which then moves focus to the
 * first newly shown Session, also once a provisional list gives way to the
 * Agent's own list or a Retry loads the page that failed. An Agent that is not open in the page previews
 * its Sessions from the attention record and reads its own list only after
 * View more; its own list loads a further page only when the loaded rows run
 * out.
 */
export function SidebarAgentSessions({
  agentId,
  open,
  preview,
  previewComplete,
  conversationOf,
  onNavigate,
}: Props) {
  const [limit, setLimit] = useState(SIDEBAR_SESSION_STEP);
  const [focusAfter, setFocusAfter] = useState<ReadonlySet<string> | null>(
    null,
  );
  const [renaming, setRenaming] = useState<SessionView | null>(null);
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const actWhenAwake = useActWhenAwake(agentId);
  const filter = useAgentSessionFilter(agentId);
  const filtered = !!filter && isFiltered(filter);

  const sessionActions: SessionActions = {
    rename: (s) => actWhenAwake(`rename:${s.sessionId}`, () => setRenaming(s)),
    delete: async (s) => {
      const label = s.title ? `“${s.title}”` : sessionTitleLabel(s);
      if (
        await showConfirm(
          "Its transcript is deleted and cannot be recovered.",
          `Delete session ${label}?`,
          { kind: "destructive", confirmLabel: "Delete session" },
        )
      )
        actWhenAwake(`delete:${s.sessionId}`, () =>
          deleteSession(s.sessionId, agentId),
        );
    },
  };

  return (
    <>
      {open ||
      limit > SIDEBAR_SESSION_STEP ||
      (preview.length === 0 && !previewComplete) ? (
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
      ) : (
        <SessionPreview
          agentId={agentId}
          sessions={
            filtered
              ? preview.filter((item) => matchesActivityFilters(item, filter))
              : preview
          }
          filtered={filtered}
          complete={previewComplete}
          sessionActions={sessionActions}
          conversationOf={conversationOf}
          onMore={(shown) => {
            setFocusAfter(shown);
            setLimit(limit + SIDEBAR_SESSION_STEP);
          }}
          onNavigate={onNavigate}
        />
      )}
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

function SessionPreview({
  agentId,
  sessions,
  filtered,
  complete,
  sessionActions,
  conversationOf,
  onMore,
  onNavigate,
}: {
  agentId: string;
  sessions: readonly AgentActivitySession[];
  filtered: boolean;
  complete: boolean;
  sessionActions: SessionActions;
  conversationOf: Props["conversationOf"];
  onMore: (shown: ReadonlySet<string>) => void;
  onNavigate?: () => void;
}) {
  const openSession = useOpenSession();
  if (sessions.length === 0 && (complete || !filtered))
    return <ListNote>{emptyText(filtered, false)}</ListNote>;
  const visible = sidebarSessionWindow(
    sessions,
    SIDEBAR_SESSION_STEP,
    () => false,
  );
  const { more } = viewMore({
    total: sessions.length,
    shown: visible.length,
    limit: SIDEBAR_SESSION_STEP,
    hasNextPage: !complete,
    isFetchingNextPage: false,
  });

  return (
    <div className={LIST_CLASS} data-testid="sidebar-agent-sessions">
      {sessions.length === 0 && <ListNote>{emptyText(true, true)}</ListNote>}
      {visible.map((item) => {
        const session = provisionalSessionView(item.session);
        return (
          <SessionRow
            key={item.id}
            session={session}
            active={false}
            working={item.working}
            needsApproval={item.needsApproval}
            unread={item.unread}
            conversation={conversationOf(item.session)}
            className={ROW_CLASS}
            onResume={() => {
              openSession(agentId, item.session.sessionId, item.session.mode);
              onNavigate?.();
            }}
            onRename={() => sessionActions.rename(session)}
            onDelete={() => void sessionActions.delete(session)}
          />
        );
      })}
      {more && (
        <ViewMoreRow
          onClick={() =>
            onMore(new Set(visible.map((item) => item.session.sessionId)))
          }
        />
      )}
    </div>
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
  sessionActions: SessionActions;
  filter: ActivityFilters | undefined;
  limit: number;
  onLimitChange: (limit: number) => void;
  focusAfter: ReadonlySet<string> | null;
  onFocusAfterChange: (shown: ReadonlySet<string> | null) => void;
  onNavigate?: () => void;
}) {
  const list = useAgentSessionList(agentId);
  const runState = useAgentRunState(agentId);
  const asleep =
    list.loading && (runState === "hibernated" || runState === "hibernating");
  const openSession = useOpenSession();
  const telemetryFlag = useFeatures().data?.["agent-telemetry"] ?? false;
  const telemetryBackend =
    useInstallCapabilities().data?.telemetryBackend ?? false;
  const telemetryEnabled = telemetryFlag && telemetryBackend;
  const rootRef = useRef<HTMLDivElement>(null);

  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPageFailed,
    fetchNextPage,
  } = list;

  const filtered = filter !== undefined;
  const rows = newestFirst(
    list.sessions
      .map((session) => ({ session, state: list.rowState(session) }))
      .filter(
        ({ session, state }) =>
          filter === undefined ||
          state.active ||
          matchesActivityFilters(
            {
              session,
              working: state.working,
              unread: state.unread,
              needsApproval: state.needsApproval,
            },
            filter,
          ),
      ),
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
    isFetchingNextPage,
  });
  const paged = limit > SIDEBAR_SESSION_STEP;

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
    const pending = list.provisional || list.failed || fetchNextPageFailed;
    if (id || !unclaimed || !pending) onFocusAfterChange(null);
  });

  return (
    <div
      ref={rootRef}
      className={LIST_CLASS}
      data-testid="sidebar-agent-sessions"
      data-provisional={list.provisional ? "true" : undefined}
      aria-busy={list.provisional || (list.loading && !asleep && !list.failed)}
    >
      {asleep ? (
        <ListNote testId="sidebar-agent-asleep">
          Its sessions show when it wakes.
        </ListNote>
      ) : (
        list.loading && !list.failed && <SessionListSkeleton />
      )}
      {list.failed && (
        <button
          type="button"
          onClick={() => void list.retry()}
          disabled={list.retrying}
          data-testid="sidebar-agent-sessions-failed"
          className={`flex h-[30px] items-center gap-1 rounded-lg pl-12 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
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
      {visible.map(({ session: s, state }) => (
        <SessionRow
          key={s.sessionId}
          session={s}
          {...state}
          className={ROW_CLASS}
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
          {...(telemetryEnabled && {
            onExportTimeline: () =>
              void downloadTelemetryExport({
                agentId,
                sessionId: s.sessionId,
                signal: "logs",
                sinceHours: TELEMETRY_MAX_SINCE_HOURS,
              }),
          })}
        />
      ))}
      {paged && hasNextPage && fetchNextPageFailed ? (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          className={`flex h-[30px] items-center rounded-lg pl-12 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
        >
          Couldn't load the rest. Retry
        </button>
      ) : (
        next.more && (
          <ViewMoreRow
            busy={isFetchingNextPage}
            onClick={async () => {
              const shown = new Set(visibleIds);
              onLimitChange(next.limit);
              if (next.fetchNextPage) await fetchNextPage();
              onFocusAfterChange(shown);
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
    ? "No loaded sessions match the filter."
    : "No sessions match the filter.";
}

function ListNote({
  testId,
  children,
}: {
  testId?: string;
  children: ReactNode;
}) {
  return (
    <p
      className="py-1.5 pl-12 text-xs text-muted-foreground"
      data-testid={testId}
    >
      {children}
    </p>
  );
}

function ViewMoreRow({
  busy = false,
  onClick,
}: {
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={busy || undefined}
      data-testid="sidebar-agent-sessions-more"
      className={`flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg pl-12 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
    >
      View more
      {busy && <Spinner />}
    </button>
  );
}

import { SessionMode, TELEMETRY_MAX_SINCE_HOURS } from "api-server-api";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { SessionView } from "../../../../types.js";
import { useAgentRunState } from "../../../agents/api/queries.js";
import { useActWhenAwake } from "../../../agents/hooks/use-act-when-awake.js";
import {
  useFeatures,
  useInstallCapabilities,
} from "../../../features/api/queries.js";
import { isFiltered } from "../../../home/lib/activity-filter.js";
import { matchesActivityFilters } from "../../../home/lib/activity-sessions.js";
import { prefetchSessionHistory } from "../../../sessions/api/queries.js";
import { RenameSessionDialog } from "../../../sessions/components/rename-session-dialog.js";
import { SessionListSkeleton } from "../../../sessions/components/session-list-skeleton.js";
import {
  SessionRow,
  sessionTitleLabel,
} from "../../../sessions/components/session-row.js";
import { useAgentSessionList } from "../../../sessions/hooks/use-agent-session-list.js";
import { useOpenSession } from "../../../sessions/hooks/use-open-session.js";
import {
  pinKey,
  togglePinnedSession,
  unpinSession,
  usePinnedSessions,
} from "../../../sessions/lib/pinned-sessions.js";
import { newestFirst } from "../../../sessions/lib/sidebar-session-window.js";
import { downloadTelemetryExport } from "../../../telemetry/api/download-export.js";
import { activityTone, sessionContext } from "../../lib/sidebar-tree.js";
import { ActivityDot } from "./activity-dot.js";
import { FOCUS_RING } from "./add-row.js";

const ROW_CLASS = "min-w-0 rounded-lg border-b-0 px-2 py-2";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One Agent's Sessions, nested under the Agent in the new layout's sidebar tree: every Session the Agent lists except those the Pinned section above already shows, each with its activity dot and context line, the next page loaded when the list scrolls near its end, and the Sessions ordered by last activity, newest first. Rename and Delete wake the Agent and run once it answers, as in the current layout's list.
 */
export function AgentSessionList({
  agentId,
  shownAbove,
  onNavigate,
}: {
  agentId: string;
  shownAbove: ReadonlySet<string>;
  onNavigate?: () => void;
}) {
  const list = useAgentSessionList(agentId);
  const filters = useStore((s) => s.sidebarActivityFilters);
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const actWhenAwake = useActWhenAwake(agentId);
  const runState = useAgentRunState(agentId);
  const asleep =
    list.loading &&
    list.recordRead &&
    (runState === "hibernated" || runState === "hibernating");
  const openSession = useOpenSession();
  const pins = usePinnedSessions();
  const [renaming, setRenaming] = useState<SessionView | null>(null);
  const telemetryFlag = useFeatures().data?.["agent-telemetry"] ?? false;
  const telemetryBackend =
    useInstallCapabilities().data?.telemetryBackend ?? false;
  const telemetryEnabled = telemetryFlag && telemetryBackend;

  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPageFailed,
    fetchNextPage,
  } = list;
  const canFetch = hasNextPage && !isFetchingNextPage && !fetchNextPageFailed;
  const endRef = useLoadOnReach(canFetch, () => void fetchNextPage());
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
  const isPinned = (id: string) => pins.has(pinKey(agentId, id));
  const shown = rows.filter(
    (row) => !shownAbove.has(pinKey(agentId, row.session.sessionId)),
  );

  const remove = async (s: SessionView) => {
    const label = s.title ? `“${s.title}”` : sessionTitleLabel(s);
    if (
      await showConfirm(
        "Its transcript is deleted and cannot be recovered.",
        `Delete session ${label}?`,
        { kind: "destructive", confirmLabel: "Delete session" },
      )
    )
      actWhenAwake(`delete:${s.sessionId}`, async () => {
        if (!(await deleteSession(s.sessionId, agentId))) return;
        unpinSession(pinKey(agentId, s.sessionId));
      });
  };

  const row = ({ session: s, state }: (typeof rows)[number]) => (
    <div key={s.sessionId} className="relative">
      <SessionRow
        session={s}
        {...state}
        conversation={sessionContext(s, state.conversation)}
        leading={<ActivityDot tone={activityTone(state)} />}
        indicators={false}
        className={ROW_CLASS}
        pinned={isPinned(s.sessionId)}
        onTogglePin={() => togglePinnedSession(pinKey(agentId, s.sessionId))}
        onResume={() => {
          openSession(agentId, s.sessionId, s.mode);
          onNavigate?.();
        }}
        {...(list.operable &&
          s.mode !== SessionMode.Terminal && {
            onPrefetch: () => prefetchSessionHistory(agentId, s.sessionId),
          })}
        onRename={() =>
          actWhenAwake(`rename:${s.sessionId}`, () => setRenaming(s))
        }
        onDelete={() => void remove(s)}
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
    </div>
  );

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
      {shown.map(row)}
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
      {renaming && (
        <RenameSessionDialog
          agentId={agentId}
          session={renaming}
          onClose={() => setRenaming(null)}
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

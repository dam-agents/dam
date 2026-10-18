import { SessionMode, TELEMETRY_MAX_SINCE_HOURS } from "api-server-api";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { labelVariants } from "@/components/ui/label";

import { useStore } from "../../../../store.js";
import type { SessionView } from "../../../../types.js";
import { OrderDropIndicator } from "../../../agents/components/order-drop-indicator.js";
import { useActWhenAwake } from "../../../agents/hooks/use-act-when-awake.js";
import { useOrderDrag } from "../../../agents/hooks/use-order-drag.js";
import type { useSidebarOrderActions } from "../../../agents/hooks/use-sidebar-order-actions.js";
import { manualOrder } from "../../../agents/lib/sidebar-order.js";
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
import { downloadTelemetryExport } from "../../../telemetry/api/download-export.js";

const ROW_CLASS = "min-w-0 rounded-lg border-b-0 px-2 py-2";

type OrderActions = ReturnType<typeof useSidebarOrderActions>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: One Agent's own Session list in the new layout's sidebar: every Session the Agent lists, its pinned ones in their own section above the rest, the next page loaded when the list scrolls near its end, and the manual order applied and set by drag and drop. Rename and Delete wake the Agent and run once it answers, as in the current layout's list.
 */
export function AgentSessionList({
  agentId,
  order,
  orderActions,
  onNavigate,
}: {
  agentId: string;
  order: readonly string[];
  orderActions: OrderActions;
  onNavigate?: () => void;
}) {
  const list = useAgentSessionList(agentId);
  const filters = useStore((s) => s.sidebarActivityFilters);
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const actWhenAwake = useActWhenAwake(agentId);
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
  const loadedIds = new Set(list.sessions.map((s) => s.sessionId));
  const pinMissing = [...pins].some(
    (key) =>
      key.startsWith(`${agentId}:`) &&
      !loadedIds.has(key.slice(agentId.length + 1)),
  );
  useEffect(() => {
    if (canFetch && pinMissing && !list.provisional) void fetchNextPage();
  }, [canFetch, pinMissing, list.provisional, fetchNextPage]);

  const rows = manualOrder(
    list.sessions
      .map((session) => ({ session, state: list.rowState(session) }))
      .filter(({ session, state }) =>
        matchesActivityFilters(
          { session, working: state.working, unread: state.unread },
          filters,
        ),
      ),
    order,
    (row) => row.session.sessionId,
    (row) => row.session.createdAt,
  );
  const isPinned = (id: string) => pins.has(pinKey(agentId, id));
  const pinned = rows.filter((row) => isPinned(row.session.sessionId));
  const rest = rows.filter((row) => !isPinned(row.session.sessionId));
  const shown = [...pinned, ...rest].map((row) => row.session.sessionId);

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
        orderActions.forgetSession(agentId, s.sessionId);
        unpinSession(pinKey(agentId, s.sessionId));
      });
  };

  const row = ({ session: s, state }: (typeof rows)[number]) => (
    <OrderedRow
      key={s.sessionId}
      agentId={agentId}
      sessionId={s.sessionId}
      shown={shown}
      orderActions={orderActions}
    >
      <SessionRow
        session={s}
        {...state}
        reorderable={orderActions.ready}
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
    </OrderedRow>
  );

  return (
    <div
      className="flex flex-col gap-px pb-1"
      data-testid="sidebar-agent-sessions"
      data-provisional={list.provisional ? "true" : undefined}
      aria-busy={list.provisional || list.loading}
    >
      {list.loading && <SessionListSkeleton />}
      {!list.loading && rows.length === 0 && !hasNextPage && (
        <p className="py-1.5 pl-2 text-xs text-muted-foreground">
          {isFiltered(filters)
            ? "No sessions match the filter."
            : "No sessions yet."}
        </p>
      )}
      {pinned.length > 0 && (
        <>
          <ListLabel>Pinned</ListLabel>
          {pinned.map(row)}
          <ListLabel>Recent</ListLabel>
        </>
      )}
      {rest.map(row)}
      {hasNextPage && <div ref={endRef} aria-hidden className="h-px" />}
      {isFetchingNextPage && <SessionListSkeleton />}
      {hasNextPage && fetchNextPageFailed && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          className="flex h-[30px] items-center rounded-lg pl-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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

function OrderedRow({
  agentId,
  sessionId,
  shown,
  orderActions,
  children,
}: {
  agentId: string;
  sessionId: string;
  shown: readonly string[];
  orderActions: OrderActions;
  children: ReactNode;
}) {
  const drag = useOrderDrag({
    scope: `sessions:${agentId}`,
    id: sessionId,
    ready: orderActions.ready,
    onMove: (id, drop) => orderActions.moveSession(agentId, shown, id, drop),
    onStep: (id, step) => orderActions.stepSession(agentId, shown, id, step),
  });
  return (
    <div {...drag.dragProps} className="relative">
      {children}
      <OrderDropIndicator at={drag.indicator} />
    </div>
  );
}

function ListLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-3 pb-1.5 first:pt-0">
      <span className={labelVariants()}>{children}</span>
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

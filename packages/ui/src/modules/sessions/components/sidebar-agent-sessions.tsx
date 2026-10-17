import { ChevronDown, ChevronUp } from "@carbon/icons-react";
import {
  type AttentionItem,
  SessionMode,
  TELEMETRY_MAX_SINCE_HOURS,
} from "api-server-api";
import { Fragment, type ReactNode, useState } from "react";

import { labelVariants } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { TREE_GUIDE } from "@/components/ui/tree-guide";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useIsAgentAnswerableSoon } from "../../agents/api/queries.js";
import { OrderDropIndicator } from "../../agents/components/order-drop-indicator.js";
import { useActWhenAwake } from "../../agents/hooks/use-act-when-awake.js";
import { useOrderDrag } from "../../agents/hooks/use-order-drag.js";
import type { useSidebarOrderActions } from "../../agents/hooks/use-sidebar-order-actions.js";
import { manualOrder } from "../../agents/lib/sidebar-order.js";
import { useFeatures } from "../../features/api/queries.js";
import type { AgentActivitySession } from "../../home/hooks/use-activity-sessions.js";
import { isFiltered } from "../../home/lib/activity-filter.js";
import { matchesActivityFilters } from "../../home/lib/activity-sessions.js";
import { downloadTelemetryExport } from "../../telemetry/api/download-export.js";
import {
  prefetchSessionHistory,
  provisionalSessionView,
  useSessionsById,
} from "../api/queries.js";
import { useAgentSessionList } from "../hooks/use-agent-session-list.js";
import { useOpenSession } from "../hooks/use-open-session.js";
import {
  pinKey,
  togglePinnedSession,
  usePinnedSessions,
} from "../lib/pinned-sessions.js";
import {
  moreClick,
  sessionListControls,
  SIDEBAR_PREVIEW_SESSIONS,
  sidebarSessionWindow,
} from "../lib/sidebar-session-window.js";
import { RenameSessionDialog } from "./rename-session-dialog.js";
import { SessionListSkeleton } from "./session-list-skeleton.js";
import { SessionRow } from "./session-row.js";

const ROW_CLASS = "rounded-lg border-b-0 py-1.5 pr-2 pl-9";
const FLAT_ROW_CLASS = "min-w-0 rounded-lg border-b-0 px-2 py-2";

type OrderActions = ReturnType<typeof useSidebarOrderActions>;

interface SessionActions {
  rename: (session: SessionView) => void;
  delete: (session: SessionView) => Promise<void>;
}

interface Props {
  agentId: string;
  open: boolean;
  preview: readonly AgentActivitySession[];
  previewComplete: boolean;
  order: readonly string[];
  orderActions: OrderActions;
  conversationOf: (session: AttentionItem) => string | undefined;
  stickyClassName: string;
  flat?: boolean;
  onNavigate?: () => void;
}

export function SidebarAgentSessions({
  agentId,
  open,
  preview,
  previewComplete,
  order,
  orderActions,
  conversationOf,
  stickyClassName,
  flat = false,
  onNavigate,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState<SessionView | null>(null);
  const answerable = useIsAgentAnswerableSoon(agentId);
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const actWhenAwake = useActWhenAwake(agentId);

  const sessionActions: SessionActions = {
    rename: (s) => actWhenAwake(`rename:${s.sessionId}`, () => setRenaming(s)),
    delete: async (s) => {
      const label = s.title || s.sessionId.slice(0, 12);
      if (
        await showConfirm(
          "Its transcript is deleted and cannot be recovered.",
          `Delete session “${label}”?`,
          { kind: "destructive", confirmLabel: "Delete session" },
        )
      )
        actWhenAwake(`delete:${s.sessionId}`, async () => {
          if (await deleteSession(s.sessionId, agentId))
            orderActions.forgetSession(agentId, s.sessionId);
        });
    },
  };

  return (
    <>
      {open || expanded || (order.length > 0 && answerable) ? (
        <AgentSessionList
          agentId={agentId}
          order={order}
          orderActions={orderActions}
          sessionActions={sessionActions}
          expanded={expanded}
          onExpandedChange={setExpanded}
          stickyClassName={stickyClassName}
          flat={flat}
          onNavigate={onNavigate}
        />
      ) : (
        <SessionPreview
          agentId={agentId}
          sessions={preview}
          complete={previewComplete}
          order={order}
          orderActions={orderActions}
          sessionActions={sessionActions}
          conversationOf={conversationOf}
          onExpand={() => setExpanded(true)}
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
  sessions: recent,
  complete,
  order,
  orderActions,
  sessionActions,
  conversationOf,
  onExpand,
  onNavigate,
}: {
  agentId: string;
  sessions: readonly AgentActivitySession[];
  complete: boolean;
  order: readonly string[];
  orderActions: OrderActions;
  sessionActions: SessionActions;
  conversationOf: Props["conversationOf"];
  onExpand: () => void;
  onNavigate?: () => void;
}) {
  const openSession = useOpenSession();
  const sessions = manualOrder(
    recent,
    order,
    (item) => item.session.sessionId,
    (item) => item.session.createdAt,
  );
  if (sessions.length === 0) return null;
  const visible = sidebarSessionWindow(sessions, false, () => false);
  const shown = visible.map((item) => item.session.sessionId);
  const { more } = sessionListControls({
    total: sessions.length,
    expanded: false,
    hasNextPage: !complete,
  });

  return (
    <div
      className="flex flex-col gap-px pb-1 [--tree-guide-x:20px]"
      data-testid="sidebar-agent-sessions"
    >
      {visible.map((item) => {
        const session = provisionalSessionView(item.session);
        return (
          <OrderedRow
            key={item.id}
            agentId={agentId}
            sessionId={item.session.sessionId}
            shown={shown}
            orderActions={orderActions}
          >
            <SessionRow
              session={session}
              active={false}
              working={item.working}
              needsApproval={false}
              unread={item.unread}
              conversation={conversationOf(item.session)}
              reorderable={orderActions.ready}
              className={ROW_CLASS}
              onResume={() => {
                openSession(agentId, item.session.sessionId, item.session.mode);
                onNavigate?.();
              }}
              onRename={() => sessionActions.rename(session)}
              onDelete={() => void sessionActions.delete(session)}
            />
          </OrderedRow>
        );
      })}
      {more && <ToggleRow more onClick={onExpand} />}
    </div>
  );
}

function AgentSessionList({
  agentId,
  order,
  orderActions,
  sessionActions,
  expanded,
  onExpandedChange,
  stickyClassName,
  flat,
  onNavigate,
}: {
  agentId: string;
  order: readonly string[];
  orderActions: OrderActions;
  sessionActions: SessionActions;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  stickyClassName: string;
  flat: boolean;
  onNavigate?: () => void;
}) {
  const list = useAgentSessionList(agentId);
  const filters = useStore((s) => s.sidebarActivityFilters);
  const openSession = useOpenSession();
  const telemetryEnabled = useFeatures().data?.["agent-telemetry"] ?? false;

  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPageFailed,
    fetchNextPage,
  } = list;

  const listed = new Set(list.sessions.map((session) => session.sessionId));
  const unlisted = useSessionsById(
    agentId,
    order.slice(0, SIDEBAR_PREVIEW_SESSIONS).filter((id) => !listed.has(id)),
    { enabled: list.operable && !expanded },
  );
  const rows = manualOrder(
    [...unlisted, ...list.sessions]
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
  const pins = usePinnedSessions();
  const isPinned = (id: string) => flat && pins.has(pinKey(agentId, id));
  const pinnedRows = rows.filter((row) => isPinned(row.session.sessionId));
  const unpinnedRows = rows.filter((row) => !isPinned(row.session.sessionId));
  const visible = [
    ...pinnedRows,
    ...sidebarSessionWindow(unpinnedRows, expanded, (row) => row.state.active),
  ];
  const shown = visible.map((row) => row.session.sessionId);
  const { more, less } = sessionListControls({
    total: unpinnedRows.length,
    expanded,
    hasNextPage,
  });
  const onMore = () => {
    const click = moreClick({
      total: unpinnedRows.length,
      expanded,
      hasNextPage,
      isFetchingNextPage,
    });
    if (click.expand) onExpandedChange(true);
    if (click.fetchNextPage) void fetchNextPage();
  };

  return (
    <div
      className="flex flex-col gap-px pb-1 [--tree-guide-x:20px]"
      data-testid="sidebar-agent-sessions"
      data-provisional={list.provisional ? "true" : undefined}
      aria-busy={list.provisional || list.loading}
    >
      {list.loading && <SessionListSkeleton />}
      {!list.loading && rows.length === 0 && !hasNextPage && (
        <p
          className={cn(
            "py-1.5 text-xs text-muted-foreground",
            flat ? "pl-2" : "pl-9",
          )}
        >
          {isFiltered(filters)
            ? "No sessions match the filter."
            : "No sessions yet."}
        </p>
      )}
      {visible.map(({ session: s, state }, index) => (
        <Fragment key={s.sessionId}>
          {flat && pinnedRows.length > 0 && index === 0 && (
            <PinLabel>Pinned</PinLabel>
          )}
          {flat && pinnedRows.length > 0 && index === pinnedRows.length && (
            <PinLabel>Recent</PinLabel>
          )}
          <OrderedRow
            agentId={agentId}
            sessionId={s.sessionId}
            shown={shown}
            orderActions={orderActions}
            flat={flat}
          >
            <SessionRow
              session={s}
              {...state}
              reorderable={orderActions.ready}
              className={flat ? FLAT_ROW_CLASS : ROW_CLASS}
              {...(flat && {
                pinned: isPinned(s.sessionId),
                onTogglePin: () =>
                  togglePinnedSession(pinKey(agentId, s.sessionId)),
              })}
              onResume={() => {
                openSession(agentId, s.sessionId, s.mode);
                onNavigate?.();
              }}
              {...(list.operable &&
                s.mode !== SessionMode.Terminal && {
                  onPrefetch: () =>
                    prefetchSessionHistory(agentId, s.sessionId),
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
          </OrderedRow>
        </Fragment>
      ))}
      {expanded && hasNextPage && fetchNextPageFailed && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          className={cn(
            TREE_GUIDE,
            "flex h-[30px] items-center rounded-lg pl-9 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          )}
        >
          Couldn't load the rest. Retry
        </button>
      )}
      {more && !(expanded && fetchNextPageFailed) && (
        <ToggleRow
          more
          flat={flat}
          busy={isFetchingNextPage}
          onClick={onMore}
        />
      )}
      {less && (
        <ToggleRow
          more={false}
          flat={flat}
          stickyClassName={stickyClassName}
          onClick={() => onExpandedChange(false)}
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
  flat = false,
  children,
}: {
  agentId: string;
  sessionId: string;
  shown: readonly string[];
  orderActions: OrderActions;
  flat?: boolean;
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
    <div {...drag.dragProps} className={flat ? "relative" : TREE_GUIDE}>
      {children}
      <OrderDropIndicator at={drag.indicator} />
    </div>
  );
}

function ToggleRow({
  more,
  flat = false,
  busy = false,
  stickyClassName,
  onClick,
}: {
  more: boolean;
  flat?: boolean;
  busy?: boolean;
  stickyClassName?: string;
  onClick: () => void;
}) {
  const Chevron = more ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={!more}
      data-testid="sidebar-agent-sessions-toggle"
      className={cn(
        labelVariants(),
        !flat && [TREE_GUIDE, "[--tree-guide-end:15px]"],
        "flex h-[30px] shrink-0 items-center gap-1 rounded-lg text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        flat ? "pl-2" : "pl-9",
        !more && ["sticky bottom-0 z-raised", stickyClassName],
      )}
    >
      {more ? "More" : "Less"}
      <Chevron size={14} />
      {busy && <Spinner />}
    </button>
  );
}

function PinLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-3 pb-1.5 first:pt-0">
      <span className={labelVariants()}>{children}</span>
    </div>
  );
}

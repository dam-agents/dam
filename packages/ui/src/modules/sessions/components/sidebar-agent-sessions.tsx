import { ChevronDown, ChevronUp } from "@carbon/icons-react";
import {
  type AttentionItem,
  SessionMode,
  TELEMETRY_MAX_SINCE_HOURS,
} from "api-server-api";
import { type ReactNode, useEffect, useState } from "react";

import { labelVariants } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { TREE_GUIDE } from "@/components/ui/tree-guide";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useIsAgentAnswerableSoon } from "../../agents/api/queries.js";
import { OrderDropIndicator } from "../../agents/components/order-drop-indicator.js";
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
  type SessionListToggle,
  sessionListToggle,
  SIDEBAR_PREVIEW_SESSIONS,
  sidebarSessionWindow,
} from "../lib/sidebar-session-window.js";
import { RenameSessionDialog } from "./rename-session-dialog.js";
import { SessionListSkeleton } from "./session-list-skeleton.js";
import { SessionRow } from "./session-row.js";

const ROW_CLASS = "rounded-lg border-b-0 py-1.5 pr-2 pl-9";

type OrderActions = ReturnType<typeof useSidebarOrderActions>;

interface Props {
  agentId: string;
  open: boolean;
  preview: readonly AgentActivitySession[];
  previewComplete: boolean;
  order: readonly string[];
  orderActions: OrderActions;
  conversationOf: (session: AttentionItem) => string | undefined;
  stickyClassName: string;
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
  onNavigate,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const answerable = useIsAgentAnswerableSoon(agentId);
  if (open || expanded || (order.length > 0 && answerable))
    return (
      <AgentSessionList
        agentId={agentId}
        order={order}
        orderActions={orderActions}
        expanded={expanded}
        onExpandedChange={setExpanded}
        stickyClassName={stickyClassName}
        onNavigate={onNavigate}
      />
    );
  return (
    <SessionPreview
      agentId={agentId}
      sessions={preview}
      complete={previewComplete}
      order={order}
      orderActions={orderActions}
      conversationOf={conversationOf}
      onExpand={() => setExpanded(true)}
      onNavigate={onNavigate}
    />
  );
}

function SessionPreview({
  agentId,
  sessions: recent,
  complete,
  order,
  orderActions,
  conversationOf,
  onExpand,
  onNavigate,
}: {
  agentId: string;
  sessions: readonly AgentActivitySession[];
  complete: boolean;
  order: readonly string[];
  orderActions: OrderActions;
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
  const toggle = sessionListToggle({
    total: sessions.length,
    expanded: false,
    hasNextPage: !complete,
  });

  return (
    <div
      className={cn(
        "flex flex-col gap-px pb-1 [--tree-guide-x:20px] before:bottom-1",
        TREE_GUIDE,
      )}
      data-testid="sidebar-agent-sessions"
    >
      {visible.map((item) => (
        <OrderedRow
          key={item.id}
          agentId={agentId}
          sessionId={item.session.sessionId}
          shown={shown}
          orderActions={orderActions}
        >
          <SessionRow
            session={provisionalSessionView(item.session)}
            active={false}
            working={item.working}
            needsApproval={false}
            unread={item.unread}
            provisional
            conversation={conversationOf(item.session)}
            reorderable={orderActions.ready}
            className={ROW_CLASS}
            onResume={() => {
              openSession(agentId, item.session.sessionId, item.session.mode);
              onNavigate?.();
            }}
            onRename={() => {}}
            onDelete={() => {}}
          />
        </OrderedRow>
      ))}
      {toggle && <ToggleRow toggle={toggle} onClick={onExpand} />}
    </div>
  );
}

function AgentSessionList({
  agentId,
  order,
  orderActions,
  expanded,
  onExpandedChange,
  stickyClassName,
  onNavigate,
}: {
  agentId: string;
  order: readonly string[];
  orderActions: OrderActions;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  stickyClassName: string;
  onNavigate?: () => void;
}) {
  const list = useAgentSessionList(agentId);
  const filters = useStore((s) => s.sidebarActivityFilters);
  const openSession = useOpenSession();
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const telemetryEnabled = useFeatures().data?.["agent-telemetry"] ?? false;
  const [renaming, setRenaming] = useState<SessionView | null>(null);

  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPageFailed,
    fetchNextPage,
  } = list;
  useEffect(() => {
    if (expanded && hasNextPage && !isFetchingNextPage && !fetchNextPageFailed)
      void fetchNextPage();
  }, [
    expanded,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPageFailed,
    fetchNextPage,
  ]);

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
  const visible = sidebarSessionWindow(
    rows,
    expanded,
    (row) => row.state.active,
  );
  const shown = visible.map((row) => row.session.sessionId);
  const toggle = sessionListToggle({
    total: rows.length,
    expanded,
    hasNextPage,
  });

  const confirmDelete = async (s: SessionView) => {
    const label = s.title || s.sessionId.slice(0, 12);
    if (
      await showConfirm(
        "Its transcript is deleted and cannot be recovered.",
        `Delete session “${label}”?`,
        { kind: "destructive", confirmLabel: "Delete session" },
      )
    ) {
      if (await deleteSession(s.sessionId, agentId))
        orderActions.forgetSession(agentId, s.sessionId);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-px pb-1 [--tree-guide-x:20px] before:bottom-1",
        TREE_GUIDE,
      )}
      data-testid="sidebar-agent-sessions"
      data-provisional={list.provisional ? "true" : undefined}
      aria-busy={list.provisional || list.loading}
    >
      {list.loading && <SessionListSkeleton />}
      {!list.loading && rows.length === 0 && !hasNextPage && (
        <p className="py-1.5 pl-9 text-xs text-muted-foreground">
          {isFiltered(filters)
            ? "No sessions match the filter."
            : "No sessions yet."}
        </p>
      )}
      {visible.map(({ session: s, state }) => (
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
            onResume={() => {
              openSession(agentId, s.sessionId, s.mode);
              onNavigate?.();
            }}
            {...(list.operable &&
              s.mode !== SessionMode.Terminal && {
                onPrefetch: () => prefetchSessionHistory(agentId, s.sessionId),
              })}
            onRename={() => setRenaming(s)}
            onDelete={() => void confirmDelete(s)}
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
      ))}
      {expanded && hasNextPage && fetchNextPageFailed && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          className="flex h-[30px] items-center rounded-lg pl-9 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Couldn't load the rest. Retry
        </button>
      )}
      {toggle && (
        <ToggleRow
          toggle={toggle}
          busy={isFetchingNextPage}
          stickyClassName={stickyClassName}
          onClick={() => onExpandedChange(toggle === "more")}
        />
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

function ToggleRow({
  toggle,
  busy = false,
  stickyClassName,
  onClick,
}: {
  toggle: Exclude<SessionListToggle, null>;
  busy?: boolean;
  stickyClassName?: string;
  onClick: () => void;
}) {
  const more = toggle === "more";
  const Chevron = more ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={!more}
      data-testid="sidebar-agent-sessions-toggle"
      className={cn(
        labelVariants(),
        "flex h-[30px] shrink-0 items-center gap-1 rounded-lg pl-9 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        !more && ["sticky bottom-0 z-raised", stickyClassName],
      )}
    >
      {more ? "More" : "Less"}
      <Chevron size={14} />
      {busy && <Spinner />}
    </button>
  );
}

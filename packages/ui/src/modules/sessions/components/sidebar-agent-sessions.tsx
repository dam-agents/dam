import { ChevronDown, ChevronUp } from "@carbon/icons-react";
import {
  type AttentionItem,
  SessionMode,
  TELEMETRY_MAX_SINCE_HOURS,
} from "api-server-api";
import { useEffect, useState } from "react";

import { labelVariants } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useFeatures } from "../../features/api/queries.js";
import type { AgentActivitySession } from "../../home/hooks/use-activity-sessions.js";
import { isFiltered } from "../../home/lib/activity-filter.js";
import { matchesActivityFilters } from "../../home/lib/activity-sessions.js";
import { downloadTelemetryExport } from "../../telemetry/api/download-export.js";
import {
  prefetchSessionHistory,
  provisionalSessionView,
} from "../api/queries.js";
import { useAgentSessionList } from "../hooks/use-agent-session-list.js";
import { useOpenSession } from "../hooks/use-open-session.js";
import {
  type SessionListToggle,
  sessionListToggle,
  sidebarSessionWindow,
} from "../lib/sidebar-session-window.js";
import { RenameSessionDialog } from "./rename-session-dialog.js";
import { SessionListSkeleton } from "./session-list-skeleton.js";
import { SessionRow } from "./session-row.js";

const ROW_CLASS = "rounded-lg border-b-0 py-1.5 pr-2 pl-9";

interface Props {
  agentId: string;
  open: boolean;
  preview: readonly AgentActivitySession[];
  conversationOf: (session: AttentionItem) => string | undefined;
  stickyClassName: string;
  onNavigate?: () => void;
}

export function SidebarAgentSessions({
  agentId,
  open,
  preview,
  conversationOf,
  stickyClassName,
  onNavigate,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  if (open || expanded)
    return (
      <AgentSessionList
        agentId={agentId}
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
      conversationOf={conversationOf}
      onExpand={() => setExpanded(true)}
      onNavigate={onNavigate}
    />
  );
}

function SessionPreview({
  agentId,
  sessions,
  conversationOf,
  onExpand,
  onNavigate,
}: {
  agentId: string;
  sessions: readonly AgentActivitySession[];
  conversationOf: Props["conversationOf"];
  onExpand: () => void;
  onNavigate?: () => void;
}) {
  const openSession = useOpenSession();
  if (sessions.length === 0) return null;
  const toggle = sessionListToggle({
    total: sessions.length,
    expanded: false,
    hasNextPage: false,
  });

  return (
    <div
      className="flex flex-col gap-px pb-1"
      data-testid="sidebar-agent-sessions"
    >
      {sidebarSessionWindow(sessions, false, () => false).map((item) => (
        <SessionRow
          key={item.id}
          session={provisionalSessionView(item.session)}
          active={false}
          working={item.working}
          needsApproval={false}
          unread={item.unread}
          provisional
          conversation={conversationOf(item.session)}
          className={ROW_CLASS}
          onResume={() => {
            openSession(agentId, item.session.sessionId, item.session.mode);
            onNavigate?.();
          }}
          onRename={() => {}}
          onDelete={() => {}}
        />
      ))}
      {toggle && <ToggleRow toggle={toggle} onClick={onExpand} />}
    </div>
  );
}

function AgentSessionList({
  agentId,
  expanded,
  onExpandedChange,
  stickyClassName,
  onNavigate,
}: {
  agentId: string;
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

  const rows = list.sessions
    .map((session) => ({ session, state: list.rowState(session) }))
    .filter(({ session, state }) =>
      matchesActivityFilters(
        { session, working: state.working, unread: state.unread },
        filters,
      ),
    );
  const visible = sidebarSessionWindow(
    rows,
    expanded,
    (row) => row.state.active,
  );
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
      void deleteSession(s.sessionId, agentId);
    }
  };

  return (
    <div
      className="flex flex-col gap-px pb-1"
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

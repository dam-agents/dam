import { ChevronDown, ChevronUp } from "@carbon/icons-react";
import {
  type AttentionItem,
  SessionMode,
  TELEMETRY_MAX_SINCE_HOURS,
} from "api-server-api";
import { type ReactNode, useState } from "react";

import { labelVariants } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { TREE_GUIDE } from "@/components/ui/tree-guide";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useAgentRunState } from "../../agents/api/queries.js";
import { useActWhenAwake } from "../../agents/hooks/use-act-when-awake.js";
import {
  useFeatures,
  useInstallCapabilities,
} from "../../features/api/queries.js";
import type { AgentActivitySession } from "../../home/hooks/use-activity-sessions.js";
import { downloadTelemetryExport } from "../../telemetry/api/download-export.js";
import {
  prefetchSessionHistory,
  provisionalSessionView,
} from "../api/queries.js";
import { useAgentSessionList } from "../hooks/use-agent-session-list.js";
import { useOpenSession } from "../hooks/use-open-session.js";
import { sessionTitleLabel } from "../lib/session-title.js";
import {
  moreClick,
  newestFirst,
  sessionListControls,
  sidebarSessionWindow,
} from "../lib/sidebar-session-window.js";
import { RenameSessionDialog } from "./rename-session-dialog.js";
import { SessionListSkeleton } from "./session-list-skeleton.js";
import { SessionRow } from "./session-row.js";

const ROW_CLASS = "rounded-lg border-b-0 py-1.5 pr-2 pl-9";

interface SessionActions {
  rename: (session: SessionView) => void;
  delete: (session: SessionView) => Promise<void>;
}

interface Props {
  agentId: string;
  open: boolean;
  shown: boolean;
  preview: readonly AgentActivitySession[];
  previewComplete: boolean;
  conversationOf: (session: AttentionItem) => string | undefined;
  stickyClassName: string;
  onNavigate?: () => void;
}

export function SidebarAgentSessions({
  agentId,
  open,
  shown,
  preview,
  previewComplete,
  conversationOf,
  stickyClassName,
  onNavigate,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState<SessionView | null>(null);
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const actWhenAwake = useActWhenAwake(agentId);

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
      {!shown ? null : open ||
        expanded ||
        (preview.length === 0 && !previewComplete) ? (
        <AgentSessionList
          agentId={agentId}
          sessionActions={sessionActions}
          expanded={expanded}
          onExpandedChange={setExpanded}
          stickyClassName={stickyClassName}
          onNavigate={onNavigate}
        />
      ) : (
        <SessionPreview
          agentId={agentId}
          sessions={preview}
          complete={previewComplete}
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
  sessions,
  complete,
  sessionActions,
  conversationOf,
  onExpand,
  onNavigate,
}: {
  agentId: string;
  sessions: readonly AgentActivitySession[];
  complete: boolean;
  sessionActions: SessionActions;
  conversationOf: Props["conversationOf"];
  onExpand: () => void;
  onNavigate?: () => void;
}) {
  const openSession = useOpenSession();
  if (sessions.length === 0) return <ListNote>No sessions yet.</ListNote>;
  const visible = sidebarSessionWindow(sessions, false, () => false);
  const { more } = sessionListControls({
    total: sessions.length,
    collapsed: visible.length,
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
          <div key={item.id} className={TREE_GUIDE}>
            <SessionRow
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
          </div>
        );
      })}
      {more && <ToggleRow more onClick={onExpand} />}
    </div>
  );
}

function AgentSessionList({
  agentId,
  sessionActions,
  expanded,
  onExpandedChange,
  stickyClassName,
  onNavigate,
}: {
  agentId: string;
  sessionActions: SessionActions;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  stickyClassName: string;
  onNavigate?: () => void;
}) {
  const list = useAgentSessionList(agentId);
  const runState = useAgentRunState(agentId);
  const asleep =
    list.loading &&
    list.recordRead &&
    (runState === "hibernated" || runState === "hibernating");
  const openSession = useOpenSession();
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

  const rows = newestFirst(
    list.sessions.map((session) => ({
      session,
      state: list.rowState(session),
    })),
    (row) => row.session.updatedAt ?? row.session.createdAt,
    (row) => row.session.sessionId,
  );
  const isActive = (row: (typeof rows)[number]) => row.state.active;
  const visible = sidebarSessionWindow(rows, expanded, isActive);
  const collapsed = expanded
    ? sidebarSessionWindow(rows, false, isActive).length
    : visible.length;
  const { more, less } = sessionListControls({
    total: rows.length,
    collapsed,
    expanded,
    hasNextPage,
  });
  const onMore = () => {
    const click = moreClick({
      total: rows.length,
      collapsed,
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
      aria-busy={list.provisional || (list.loading && !asleep)}
    >
      {asleep ? (
        <ListNote testId="sidebar-agent-asleep">
          Its sessions show when it wakes.
        </ListNote>
      ) : (
        list.loading && <SessionListSkeleton />
      )}
      {!list.loading && rows.length === 0 && !hasNextPage && (
        <ListNote>No sessions yet.</ListNote>
      )}
      {visible.map(({ session: s, state }) => (
        <div key={s.sessionId} className={TREE_GUIDE}>
          <SessionRow
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
        </div>
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
        <ToggleRow more busy={isFetchingNextPage} onClick={onMore} />
      )}
      {less && (
        <ToggleRow
          more={false}
          stickyClassName={stickyClassName}
          onClick={() => onExpandedChange(false)}
        />
      )}
    </div>
  );
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
      className="py-1.5 pl-9 text-xs text-muted-foreground"
      data-testid={testId}
    >
      {children}
    </p>
  );
}

function ToggleRow({
  more,
  busy = false,
  stickyClassName,
  onClick,
}: {
  more: boolean;
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
        TREE_GUIDE,
        "[--tree-guide-end:15px]",
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

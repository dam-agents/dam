import { Add, ArrowLeft, Filter } from "@carbon/icons-react";
import {
  SESSION_CATEGORIES,
  sessionCategoryOf,
  SessionMode,
  TELEMETRY_MAX_SINCE_HOURS,
} from "api-server-api";
import { type CSSProperties, type Ref, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { isUnreadSession } from "../../home/lib/unread.js";
import { useSessionCosts } from "../../metrics/api/queries.js";
import { downloadTelemetryExport } from "../../telemetry/api/download-export.js";
import { useAgentBackgroundWork } from "../api/background-work.js";
import { setSessionSeen, useSessionPages } from "../api/queries.js";
import { draftKey, keysWithDraftContent } from "../lib/draft-key.js";
import { SESSION_CATEGORY_LABELS } from "../lib/session-category.js";
import { useSessionConversations } from "../lib/use-session-conversations.js";
import { SessionListSkeleton } from "./session-list-skeleton.js";
import { SessionRow } from "./session-row.js";
import { SidebarSection } from "./sidebar-section.js";

const EMPTY: never[] = [];

export function SessionsSidebar({
  open,
  onToggle,
  className,
  style,
  ref,
  onResumeSession,
  onNewSession,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
  onResumeSession: (sid: string, mode?: SessionMode) => void;
  onNewSession: () => void;
}) {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const sessionId = useStore((s) => s.sessionId);
  const busy = useStore((s) => s.busy);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const sessionFilter = useStore((s) => s.sessionFilter);
  const toggleSessionFilter = useStore((s) => s.toggleSessionFilter);
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const goBack = useStore((s) => s.goBack);

  const agentOperable = useIsAgentOperable(selectedAgent);
  const conversationOf = useSessionConversations(selectedAgent);
  const {
    sessions: listed,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useSessionPages(selectedAgent, sessionFilter, {
    enabled: agentOperable,
    activeSessionId: sessionId,
  });
  const sessions: SessionView[] = listed ?? EMPTY;
  const loading = listed === undefined && isFetching;
  const filtered = sessionFilter.length < SESSION_CATEGORIES.length;

  const visibleSessions = useMemo(
    () => sessions.filter((s) => sessionFilter.includes(sessionCategoryOf(s))),
    [sessions, sessionFilter],
  );

  const { data: features } = useFeatures();
  const sessionCosts = useSessionCosts(selectedAgent, sessions);
  const telemetryEnabled = features?.["agent-telemetry"] ?? false;

  const { data: approvals = EMPTY } = useApprovalsForAgent(selectedAgent);
  const approvalSessions = useMemo(() => {
    const set = new Set<string>();
    for (const a of approvals)
      if (a.status === "pending" && a.sessionId) set.add(a.sessionId);
    return set;
  }, [approvals]);

  const backgroundWork = useAgentBackgroundWork(selectedAgent);
  const backgroundWorkBySession = useMemo(
    () => new Map(backgroundWork.map((s) => [s.sessionId, s.items])),
    [backgroundWork],
  );

  const draftKeys = useStore(useShallow((s) => keysWithDraftContent(s.drafts)));
  const draftKeySet = useMemo(() => new Set(draftKeys), [draftKeys]);

  const confirmDelete = async (
    sid: string,
    title: string | null | undefined,
  ) => {
    const label = title || sid.slice(0, 12);
    if (await showConfirm(`Delete session "${label}"?`, "Delete Session")) {
      deleteSession(sid);
    }
  };

  const renderRow = (s: (typeof sessions)[number]) => {
    const isOpen = s.sessionId === sessionId;
    const working =
      s.mode === SessionMode.Terminal
        ? !!s.running
        : isOpen
          ? busy || !!s.running
          : !!s.running;
    const needsApproval =
      approvalSessions.has(s.sessionId) ||
      pendingPermissions.some((p) => p.sessionId === s.sessionId);
    const unread = isUnreadSession(s, { open: isOpen });
    const draft =
      s.mode !== SessionMode.Terminal &&
      !!selectedAgent &&
      draftKeySet.has(draftKey(selectedAgent, s.sessionId));
    return (
      <SessionRow
        key={s.sessionId}
        session={s}
        active={isOpen}
        working={working}
        needsApproval={needsApproval}
        unread={unread}
        draft={draft}
        backgroundWork={backgroundWorkBySession.get(s.sessionId)}
        cost={sessionCosts.get(s.sessionId)}
        conversation={conversationOf(s)}
        onResume={() => {
          if (selectedAgent) setSessionSeen(selectedAgent, s.sessionId);
          onResumeSession(s.sessionId, s.mode);
        }}
        onDelete={() => confirmDelete(s.sessionId, s.title)}
        {...(telemetryEnabled && selectedAgent
          ? {
              onExportTimeline: () =>
                void downloadTelemetryExport({
                  agentId: selectedAgent,
                  sessionId: s.sessionId,
                  signal: "logs",
                  sinceHours: TELEMETRY_MAX_SINCE_HOURS,
                }),
            }
          : {})}
      />
    );
  };

  const headerRight = (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="min-w-0 text-sm font-normal text-muted-foreground"
          >
            <Filter size={14} />
            <span className="truncate">
              {sessionFilter.length === SESSION_CATEGORIES.length
                ? "All"
                : `Filter (${sessionFilter.length})`}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {SESSION_CATEGORIES.map((category) => (
            <DropdownMenuCheckboxItem
              key={category}
              checked={sessionFilter.includes(category)}
              onCheckedChange={() => toggleSessionFilter(category)}
              onSelect={(e) => e.preventDefault()}
            >
              {SESSION_CATEGORY_LABELS[category]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="outline"
        size="xs"
        className="text-sm max-md:mr-10"
        onClick={onNewSession}
      >
        <Add size={12} /> New
      </Button>
    </>
  );

  const headerLeft = (
    <Button
      variant="ghost"
      size="icon-xs"
      className="md:hidden"
      onClick={goBack}
    >
      <ArrowLeft size={14} />
    </Button>
  );

  return (
    <SidebarSection
      title="Sessions"
      open={open}
      onToggle={onToggle}
      headerLeft={headerLeft}
      headerRight={headerRight}
      className={className}
      style={style}
      ref={ref}
    >
      <div className="flex-1 overflow-y-auto">
        {loading && <SessionListSkeleton />}
        {!loading && visibleSessions.length === 0 && (
          <p className="px-4 py-5 text-xs text-muted-foreground">
            {filtered ? "No sessions match the filter" : "No sessions yet"}
          </p>
        )}
        {visibleSessions.map(renderRow)}
        {hasNextPage && (
          <div className="px-4 py-3">
            <Button
              variant="ghost"
              size="xs"
              className="w-full text-sm font-normal text-muted-foreground"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? <Spinner /> : null}
              Show older sessions
            </Button>
          </div>
        )}
      </div>
    </SidebarSection>
  );
}

import { Add, ArrowLeft, Filter } from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import { type CSSProperties, useCallback, useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionLabel } from "@/components/ui/section-label";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { useSessionCosts } from "../../metrics/api/queries.js";
import { useAgentBackgroundWork } from "../api/background-work.js";
import { setSessionSeen, useAcpSessions } from "../api/queries.js";
import {
  SESSION_CATEGORIES,
  SESSION_CATEGORY_LABELS,
  sessionCategory,
} from "../lib/session-category.js";
import { SessionListSkeleton } from "./session-list-skeleton.js";
import { SessionRow } from "./session-row.js";
import { SidebarSection } from "./sidebar-section.js";

const EMPTY: never[] = [];

export function SessionsSidebar({
  open,
  onToggle,
  className,
  style,
  onResumeSession,
  onNewSession,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
  onResumeSession: (sid: string, mode?: SessionMode) => void;
  onNewSession: () => void;
}) {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const sessionId = useStore((s) => s.sessionId);
  const busy = useStore((s) => s.busy);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const sessionFilter = useStore((s) => s.sessionFilter);
  const toggleSessionFilter = useStore((s) => s.toggleSessionFilter);
  const listInclude = useMemo(
    () => ({
      channels: sessionFilter.includes("channels"),
      scheduled: sessionFilter.includes("scheduled"),
    }),
    [sessionFilter],
  );
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const goBack = useStore((s) => s.goBack);
  const pendingLaunch = useStore((s) => s.pendingLaunch);
  const focusPendingLaunch = useStore((s) => s.focusPendingLaunch);

  const agentOperable = useIsAgentOperable(selectedAgent);
  const { data, isFetching } = useAcpSessions(selectedAgent, listInclude, {
    enabled: agentOperable,
    activeSessionId: sessionId,
  });
  const sessions: SessionView[] = data ?? EMPTY;
  const loading = data === undefined && isFetching;

  const visibleSessions = useMemo(
    () => sessions.filter((s) => sessionFilter.includes(sessionCategory(s))),
    [sessions, sessionFilter],
  );
  const launchingRun =
    pendingLaunch &&
    pendingLaunch.agentId === selectedAgent &&
    !sessions.some((s) => s.experimentId === pendingLaunch.runId)
      ? pendingLaunch
      : null;

  const [conversationSessions, runSessions] = useMemo(
    () => [
      visibleSessions.filter((s) => sessionCategory(s) !== "experiments"),
      visibleSessions.filter((s) => sessionCategory(s) === "experiments"),
    ],
    [visibleSessions],
  );

  const { data: features } = useFeatures();
  const { data: sessionCosts } = useSessionCosts(
    selectedAgent,
    features?.["session-costs"] ?? false,
  );

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

  const confirmDelete = useCallback(
    async (sid: string, title: string | null | undefined) => {
      const label = title || sid.slice(0, 12);
      if (await showConfirm(`Delete session "${label}"?`, "Delete Session")) {
        deleteSession(sid);
      }
    },
    [showConfirm, deleteSession],
  );

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
    const unread = Boolean(
      !isOpen &&
      s.mode !== SessionMode.Terminal &&
      s.seenAt &&
      s.updatedAt &&
      Date.parse(s.updatedAt) > Date.parse(s.seenAt),
    );
    return (
      <SessionRow
        key={s.sessionId}
        session={s}
        active={isOpen}
        working={working}
        needsApproval={needsApproval}
        unread={unread}
        backgroundWork={backgroundWorkBySession.get(s.sessionId)}
        cost={sessionCosts?.get(s.sessionId)}
        onResume={() => {
          if (selectedAgent) setSessionSeen(selectedAgent, s.sessionId);
          onResumeSession(s.sessionId, s.mode);
        }}
        onDelete={() => confirmDelete(s.sessionId, s.title)}
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
            className="text-sm font-normal text-muted-foreground"
          >
            <Filter size={14} />
            {sessionFilter.length === SESSION_CATEGORIES.length
              ? "All"
              : `Filter (${sessionFilter.length})`}
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
        className="text-sm"
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
    >
      <div className="flex-1 overflow-y-auto">
        {loading && <SessionListSkeleton />}
        {!loading && sessions.length === 0 && (
          <p className="px-4 py-5 text-xs text-muted-foreground">
            No sessions yet
          </p>
        )}
        {!loading && sessions.length > 0 && visibleSessions.length === 0 && (
          <p className="px-4 py-5 text-xs text-muted-foreground">
            No sessions match the filter
          </p>
        )}
        {conversationSessions.map(renderRow)}
        {(runSessions.length > 0 || launchingRun) && (
          <SectionLabel className="block px-4 pb-1 pt-4">
            Experiment runs
          </SectionLabel>
        )}
        {launchingRun && (
          <Tooltip content="Show the launch progress">
            <button
              type="button"
              onClick={focusPendingLaunch}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50"
            >
              <Spinner />
              <span className="min-w-0 flex-1 truncate">
                Starting run — waking the agent…
              </span>
            </button>
          </Tooltip>
        )}
        {runSessions.map(renderRow)}
      </div>
    </SidebarSection>
  );
}

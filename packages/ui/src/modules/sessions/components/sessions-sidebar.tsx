import { Filter } from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import { ArrowLeft, Plus } from "lucide-react";
import { type CSSProperties, useCallback, useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionLabel } from "@/components/ui/section-label";
import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useAgentRunState } from "../../agents/api/queries.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { setSessionSeen, useAcpSessions } from "../api/queries.js";
import {
  SESSION_CATEGORIES,
  SESSION_CATEGORY_LABELS,
  sessionCategory,
} from "../lib/session-category.js";
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
  onNewTerminal,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
  onResumeSession: (sid: string, mode?: SessionMode) => void;
  onNewSession: () => void;
  onNewTerminal: () => void;
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

  const agentRunState = useAgentRunState(selectedAgent);
  const { data, isFetching } = useAcpSessions(selectedAgent, listInclude, {
    enabled: agentRunState === "running",
    activeSessionId: sessionId,
  });
  const sessions: SessionView[] = data ?? EMPTY;
  // First load only, not every refetch: the list polls every few seconds, and
  // keying the empty state off `isFetching` made "No sessions yet" blink out on
  // each poll for an agent that genuinely has none.
  const loading = data === undefined && isFetching;

  const visibleSessions = useMemo(
    () => sessions.filter((s) => sessionFilter.includes(sessionCategory(s))),
    [sessions, sessionFilter],
  );
  // Experiment runs are agent-launched, not conversations — they get their
  // own group below the sessions the user actually drives.
  // A run whose launch session hasn't materialized yet (pod waking) renders
  // as a skeleton row; the real session replaces it once the list has it.
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

  const { data: approvals = EMPTY } = useApprovalsForAgent(selectedAgent);
  const approvalSessions = useMemo(() => {
    const set = new Set<string>();
    for (const a of approvals)
      if (a.status === "pending" && a.sessionId) set.add(a.sessionId);
    return set;
  }, [approvals]);

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
    // Terminal sessions have no chat turn, so `busy` never applies.
    const working =
      s.mode === SessionMode.Terminal
        ? !!s.running
        : isOpen
          ? busy
          : !!s.running;
    // Polled approvals cover all sessions; the live store surfaces the open one instantly.
    const needsApproval =
      approvalSessions.has(s.sessionId) ||
      pendingPermissions.some((p) => p.sessionId === s.sessionId);
    // Terminals have no meaningful unread — their updatedAt tracks the
    // harness file mtime (bumped by restarts and TUI repaints), not
    // reading. No seenAt means an untracked (legacy) session — also read.
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
            className="text-[14px] font-normal text-muted-foreground"
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="xs" className="text-[14px]">
            <Plus size={12} /> New
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onNewSession}>
            New chat session
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onNewTerminal}>
            New terminal session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
        {!loading && sessions.length === 0 && (
          <p className="px-4 py-5 text-[12px] text-text-muted">
            No sessions yet
          </p>
        )}
        {!loading && sessions.length > 0 && visibleSessions.length === 0 && (
          <p className="px-4 py-5 text-[12px] text-text-muted">
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
          <button
            type="button"
            onClick={focusPendingLaunch}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-text-muted transition-colors hover:bg-muted/50"
            title="Show the launch progress"
          >
            <Spinner />
            <span className="min-w-0 flex-1 truncate">
              Starting run — waking the agent…
            </span>
          </button>
        )}
        {runSessions.map(renderRow)}
      </div>
    </SidebarSection>
  );
}

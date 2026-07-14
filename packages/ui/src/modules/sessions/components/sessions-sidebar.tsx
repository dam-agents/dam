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

import { useStore } from "../../../store.js";
import { useAgentRunState } from "../../agents/api/queries.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { AgentApprovalsTray } from "../../approvals/components/agent-approvals-tray.js";
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

  const agentRunState = useAgentRunState(selectedAgent);
  const { data: sessions = [], isFetching } = useAcpSessions(
    selectedAgent,
    listInclude,
    {
      enabled: agentRunState === "running",
      activeSessionId: sessionId,
    },
  );
  const loading = isFetching;

  const visibleSessions = useMemo(
    () => sessions.filter((s) => sessionFilter.includes(sessionCategory(s))),
    [sessions, sessionFilter],
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
        {visibleSessions.map((s) => {
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
          // No stamp means the runtime never tracked the session (legacy,
          // harness-minted) — read, not unread.
          const unread = Boolean(
            !isOpen &&
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
        })}
      </div>
      <AgentApprovalsTray agentId={selectedAgent} />
    </SidebarSection>
  );
}

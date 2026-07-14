import { SessionMode } from "api-server-api";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useAgentRunState } from "../../agents/api/queries.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { AgentApprovalsTray } from "../../approvals/components/agent-approvals-tray.js";
import { setSessionSeen, useAcpSessions } from "../api/queries.js";
import { SessionRow } from "./session-row.js";

const EMPTY: never[] = [];

export function SessionsSidebar({
  onResumeSession,
  onNewSession,
}: {
  onResumeSession: (sid: string, mode?: SessionMode) => void;
  onNewSession: () => void;
}) {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const sessionId = useStore((s) => s.sessionId);
  const busy = useStore((s) => s.busy);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const includeChannel = useStore((s) => s.includeChannelSessions);
  const setIncludeChannel = useStore((s) => s.setIncludeChannelSessions);
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const goBack = useStore((s) => s.goBack);

  const agentRunState = useAgentRunState(selectedAgent);
  const {
    data: sessions = [],
    isFetching,
    refetch,
  } = useAcpSessions(selectedAgent, includeChannel, {
    enabled: agentRunState === "running",
    activeSessionId: sessionId,
  });
  const loading = isFetching;

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

  return (
    <>
      <div className="flex items-center justify-between px-4 h-11 border-b border-border-light shrink-0 relative">
        {/* Mobile: back to agents */}
        <Button
          variant="ghost"
          size="icon-xs"
          className="md:hidden mr-2"
          onClick={goBack}
        >
          <ArrowLeft size={14} />
        </Button>
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
          Sessions
        </span>
        <Button
          variant="outline"
          size="icon-xs"
          className="ml-auto"
          onClick={() => refetch()}
        >
          <span className={loading ? "anim-spin" : ""}>
            <RefreshCw size={11} />
          </span>
        </Button>
        {loading && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent/20 overflow-hidden">
            <div className="h-full w-1/3 bg-accent rounded-full anim-slide" />
          </div>
        )}
      </div>
      <div className="px-4 py-2 border-b border-border-light">
        <label className="flex items-center gap-2 cursor-pointer text-[11px] text-text-muted">
          <input
            type="checkbox"
            checked={includeChannel}
            onChange={(e) => setIncludeChannel(e.target.checked)}
            className="accent-accent w-3 h-3"
          />
          Show channel sessions
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!loading && sessions.length === 0 && (
          <p className="px-4 py-5 text-[12px] text-text-muted">
            No sessions yet
          </p>
        )}
        {sessions.map((s) => {
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
        })}
      </div>
      <AgentApprovalsTray agentId={selectedAgent} />
      <div className="px-3 py-3 border-t border-border-light shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onNewSession}
        >
          <Plus size={13} /> New Session
        </Button>
      </div>
    </>
  );
}

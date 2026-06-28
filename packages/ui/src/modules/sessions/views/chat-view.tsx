import { SessionMode, type SessionView } from "api-server-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import { useAgents } from "../../agents/api/queries.js";
import { useRestartAgent } from "../../agents/hooks/use-restart-agent.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import { resolveAgentDisplay } from "../../agents/utils/agent-resolver.js";
import { FilesPanel } from "../../files/components/files-panel.js";
import { useFileTree } from "../../files/hooks/use-file-tree.js";
import { AgentConfigTearsheet } from "../components/agent-config-tearsheet.js";
import { ChatHeader } from "../components/chat-header.js";
import { ChatInput } from "../components/chat-input.js";
import { ChatMessages } from "../components/chat-messages.js";
import { ModelSelector } from "../components/model-selector.js";
import { SessionLogsTearsheet } from "../components/session-logs-tearsheet.js";
import { useAcpSession } from "../hooks/use-acp-session.js";
import { SessionNavWrapper } from "../layouts/session-nav/index.js";
import {
  MOCK_MESSAGES,
  MOCK_PENDING_PERMISSION,
} from "../mocks/session-content.js";

export function ChatView() {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const { data: agentsData } = useAgents();
  const agents = agentsData?.list ?? [];
  const agent = agents.find((a) => a.id === selectedAgent);
  const selectedAgentName = agent?.name ?? selectedAgent;
  const sessionError = useStore((s) => s.sessionError);
  const setSessionError = useStore((s) => s.setSessionError);
  const deleteSession = useStore((s) => s.deleteSession);
  const goBack = useStore((s) => s.goBack);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const addPendingPermission = useStore((s) => s.addPendingPermission);
  const showConfirm = useStore((s) => s.showConfirm);
  const setupPanelOpen = useStore((s) => s.setupPanelOpen);
  const restartingAgents = useStore((s) => s.restartingAgents);

  const deleteAgent = useDeleteAgent();
  const { restart: restartAgent } = useRestartAgent();
  const wakeAgent = useWakeAgent();
  const restartingIds = new Set(restartingAgents.keys());
  const agentDisplay = agent ? resolveAgentDisplay(agent, restartingIds) : null;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { resetSession, sendPrompt, stopAgent, busy, loadingSession } =
    useAcpSession(selectedAgent, textareaRef);

  const { openFileHandler } = useFileTree(selectedAgent);

  const [logsTearsheet, setLogsTearsheet] = useState<{
    sessionId: string;
    title: string;
  } | null>(null);

  const sessions: SessionView[] = useMemo(
    () => [
      // 1. Active session (opened)
      {
        sessionId: "sess-001",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-17T09:00:00Z",
        title: "New session",
        updatedAt: "2026-06-17T10:00:00Z",
      },
      // 2. Hover (just a normal session — hover state is CSS)
      {
        sessionId: "sess-002",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-17T08:00:00Z",
        title: "Write unit tests",
        updatedAt: "2026-06-17T09:30:00Z",
      },
      // 3. Unread (bold title)
      {
        sessionId: "sess-003",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-17T07:00:00Z",
        title: "Mutate parent candidate ‘p2p-1...",
        updatedAt: "2026-06-17T08:00:00Z",
      },
      // 4. Default (read)
      {
        sessionId: "sess-004",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-16T14:00:00Z",
        title: "Write unit test",
        updatedAt: "2026-06-16T15:00:00Z",
      },
      // 5. Working (animated dots)
      {
        sessionId: "sess-005",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-16T10:00:00Z",
        title: "Write unit test",
        updatedAt: "2026-06-16T11:00:00Z",
      },
      // 6. Terminal
      {
        sessionId: "sess-term-001",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Terminal,
        createdAt: "2026-06-16T08:00:00Z",
        title: "Write unit tests",
        updatedAt: "2026-06-16T08:30:00Z",
      },
      // 7. Unread & Action required (blue dot + bold)
      {
        sessionId: "sess-006",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-17T06:00:00Z",
        title: "Mutate parent candidate ‘p2p-1...",
        updatedAt: "2026-06-17T07:00:00Z",
      },
      // 8. Read & Action required (blue dot + normal weight)
      {
        sessionId: "sess-007",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-16T06:00:00Z",
        title: "Write unit tests",
        updatedAt: "2026-06-16T07:00:00Z",
      },
      // 9. Scheduled session
      {
        sessionId: "sess-sched-001",
        agentId: selectedAgent ?? "",
        type: "schedule_cron",
        mode: SessionMode.Chat,
        createdAt: "2026-06-16T06:00:00Z",
        title: "Write unit test",
        updatedAt: "2026-06-16T06:12:00Z",
        scheduleId: "sched-001",
      },
      // 10. Scheduled session + Action required
      {
        sessionId: "sess-sched-002",
        agentId: selectedAgent ?? "",
        type: "schedule_cron",
        mode: SessionMode.Chat,
        createdAt: "2026-06-16T05:00:00Z",
        title: "Write unit test",
        updatedAt: "2026-06-16T05:30:00Z",
        scheduleId: "sched-002",
      },
    ],
    [selectedAgent],
  );
  const sessionsLoading = false;
  const refetchSessions = useCallback(() => {}, []);
  const [activeTab, setActiveTab] = useState<string | null>("sess-001");

  const messages = activeTab ? (MOCK_MESSAGES[activeTab] ?? []) : [];
  const hasPendingPermission =
    activeTab === "sess-006" ||
    activeTab === "sess-007" ||
    activeTab === "sess-sched-002";

  useEffect(() => {
    const state = useStore.getState();
    const actionRequiredSessions = ["sess-006", "sess-007", "sess-sched-002"];
    for (const sid of actionRequiredSessions) {
      if (!state.pendingPermissions.some((p) => p.sessionId === sid)) {
        addPendingPermission({
          ...MOCK_PENDING_PERMISSION,
          sessionId: sid,
          resolve: () => {},
        });
      }
    }
  }, [addPendingPermission]);

  const handleResumeSession = useCallback((sid: string) => {
    setActiveTab(sid);
  }, []);

  const handleNewSession = useCallback(() => {
    setActiveTab(null);
    resetSession();
  }, [resetSession]);

  const handleDeleteSession = useCallback(
    async (sid: string, title?: string | null) => {
      const label = title || sid.slice(0, 12);
      if (await showConfirm(`Delete session "${label}"?`, "Delete Session")) {
        deleteSession(sid);
      }
    },
    [showConfirm, deleteSession],
  );

  const handleBack = useCallback(() => {
    resetSession();
    goBack();
  }, [resetSession, goBack]);

  const handleErrorBack = useCallback(() => {
    setSessionError(null);
    resetSession();
  }, [setSessionError, resetSession]);

  const handleErrorDelete = useCallback(async () => {
    const sid = sessionError?.sessionId;
    if (!sid) return;
    setSessionError(null);
    await deleteSession(sid);
  }, [sessionError, setSessionError, deleteSession]);

  const handleRenameSession = useCallback(
    (sid: string, title?: string | null) => {
      const newName = window.prompt(
        "Rename session",
        title || sid.slice(0, 12),
      );
      if (newName && newName.trim()) {
        // In a real implementation this would call an API mutation
      }
    },
    [],
  );

  const handleViewLogs = useCallback(
    (sid: string) => {
      const session = sessions.find((s) => s.sessionId === sid);
      setLogsTearsheet({
        sessionId: sid,
        title: session?.title || sid.slice(0, 12),
      });
    },
    [sessions],
  );

  const sessionNavProps = {
    sessions,
    activeSessionId: activeTab,
    loading: sessionsLoading,
    pendingPermissions,
    onResume: handleResumeSession,
    onNew: handleNewSession,
    onDelete: handleDeleteSession,
    onRename: handleRenameSession,
    onViewLogs: handleViewLogs,
    onRefresh: () => {
      refetchSessions();
    },
  };

  return (
    <div className="flex flex-1 flex-col min-w-0 min-h-0 bg-white overflow-hidden">
      {/* Top header bar — sandbox/agent name */}
      <ChatHeader
        agentName={selectedAgentName ?? ""}
        selectedAgent={selectedAgent}
        agents={agents}
        busy={busy}
        agentDisplay={agentDisplay}
        onBack={handleBack}
        onMobilePanel={() => {}}
        onToggleSetup={() => {}}
        onStart={() => selectedAgent && wakeAgent.wake(selectedAgent)}
        onRestart={() => selectedAgent && restartAgent(selectedAgent)}
        onConfigure={() =>
          useStore.getState().openSetupSection("sandbox-setup")
        }
        onDelete={async () => {
          if (!selectedAgent) return;
          const msg = (
            <>
              Are you sure you want to remove{" "}
              <strong className="text-foreground">
                &quot;{selectedAgentName}&quot;
              </strong>
              ? This will also delete all persistent data and cannot be undone.
            </>
          );
          if (
            !(await showConfirm(msg, "Remove Agent?", {
              kind: "destructive",
              confirmLabel: "Remove agent",
            }))
          )
            return;
          deleteAgent.mutate({ id: selectedAgent });
          goBack();
        }}
      />

      {/* Main content: left sessions | center chat | right files */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel: Sessions */}
        <div className="hidden md:flex w-[280px] shrink-0 flex-col border-r border-border bg-card overflow-hidden">
          <SessionNavWrapper variant="sidebar" {...sessionNavProps} />
        </div>

        {/* Center: Chat messages + input */}
        <div className="flex flex-1 flex-col min-w-0">
          <ChatMessages
            messages={messages}
            loadingSession={loadingSession}
            sessionError={sessionError}
            onErrorBack={handleErrorBack}
            onErrorDelete={handleErrorDelete}
            onRetry={sendPrompt}
            onOpenFile={openFileHandler}
          />

          {hasPendingPermission && (
            <div className="px-4 md:px-8 flex flex-col gap-1.5 mb-2">
              {/* ACP native: Bash tool call */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#0f62fe] shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary shrink-0">
                    Bash
                  </span>
                  <code className="text-[11px] font-mono text-foreground/80 truncate flex-1 min-w-0">
                    rm -rf node_modules && npm install
                  </code>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors">
                      Allow once
                    </button>
                    <button className="h-6 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                      Always allow
                    </button>
                    <button className="h-6 px-2 rounded-md text-[11px] font-medium text-destructive/70 hover:text-destructive transition-colors">
                      Reject
                    </button>
                    <button className="h-6 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                      Reject always
                    </button>
                  </div>
                </div>
              </div>
              {/* ACP native: Write tool call */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#0f62fe] shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary shrink-0">
                    Write
                  </span>
                  <code className="text-[11px] font-mono text-foreground/80 truncate flex-1 min-w-0">
                    packages/api-server/src/routes/sessions.ts
                  </code>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors">
                      Allow once
                    </button>
                    <button className="h-6 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                      Always allow
                    </button>
                    <button className="h-6 px-2 rounded-md text-[11px] font-medium text-destructive/70 hover:text-destructive transition-colors">
                      Reject
                    </button>
                    <button className="h-6 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                      Reject always
                    </button>
                  </div>
                </div>
              </div>
              {/* ext_authz: Network egress */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#0f62fe] shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                    GET
                  </span>
                  <code className="text-[11px] font-mono text-foreground/80 truncate flex-1 min-w-0">
                    registry.npmjs.org/express/latest
                  </code>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors">
                      Allow once
                    </button>
                    <button className="h-6 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                      Allow host
                    </button>
                    <button className="h-6 px-2 rounded-md text-[11px] font-medium text-destructive/70 hover:text-destructive transition-colors">
                      Deny
                    </button>
                    <button className="h-6 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
              {/* ext_authz: POST egress */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#0f62fe] shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                    POST
                  </span>
                  <code className="text-[11px] font-mono text-foreground/80 truncate flex-1 min-w-0">
                    api.github.com/repos/dam-agents/dam/pulls
                  </code>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors">
                      Allow once
                    </button>
                    <button className="h-6 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                      Allow host
                    </button>
                    <button className="h-6 px-2 rounded-md text-[11px] font-medium text-destructive/70 hover:text-destructive transition-colors">
                      Deny
                    </button>
                    <button className="h-6 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <ChatInput
            textareaRef={textareaRef}
            busy={busy}
            loadingSession={loadingSession}
            onSend={sendPrompt}
            onStop={stopAgent}
            footer={!loadingSession && <ModelSelector />}
          />
        </div>

        {/* Right panel: File explorer */}
        <div className="hidden md:flex w-[300px] shrink-0 flex-col border-l border-border bg-card overflow-hidden">
          <div className="flex items-center px-4 py-3 border-b border-border">
            <span className="text-[13px] font-semibold text-foreground">
              Explorer
            </span>
          </div>
          <FilesPanel onOpenFile={openFileHandler} />
        </div>
      </div>

      {setupPanelOpen && <AgentConfigTearsheet />}
      {logsTearsheet && (
        <SessionLogsTearsheet
          sessionTitle={logsTearsheet.title}
          onClose={() => setLogsTearsheet(null)}
        />
      )}
    </div>
  );
}

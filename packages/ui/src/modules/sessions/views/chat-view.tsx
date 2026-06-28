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
      {
        sessionId: "sess-001",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-26T09:00:00Z",
        title: "New session",
        updatedAt: "2026-06-26T10:00:00Z",
      },
      {
        sessionId: "sess-002",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-25T08:00:00Z",
        title: "Mutate parent candidate ‘p2p-1...",
        updatedAt: "2026-06-25T09:30:00Z",
      },
      {
        sessionId: "sess-003",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-24T14:00:00Z",
        title: "Debug API timeout",
        updatedAt: "2026-06-24T15:00:00Z",
      },
      {
        sessionId: "sess-004",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-24T10:00:00Z",
        title: "Write unit tests",
        updatedAt: "2026-06-24T11:00:00Z",
      },
      {
        sessionId: "sess-term-001",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Terminal,
        createdAt: "2026-06-24T08:00:00Z",
        title: "Write unit tests",
        updatedAt: "2026-06-24T08:30:00Z",
      },
      {
        sessionId: "sess-sched-001",
        agentId: selectedAgent ?? "",
        type: "schedule_cron",
        mode: SessionMode.Chat,
        createdAt: "2026-06-23T06:00:00Z",
        title: "Write unit test",
        updatedAt: "2026-06-23T06:12:00Z",
        scheduleId: "sched-001",
      },
    ],
    [selectedAgent],
  );
  const sessionsLoading = false;
  const refetchSessions = useCallback(() => {}, []);
  const [activeTab, setActiveTab] = useState<string | null>("sess-001");

  const messages = activeTab ? (MOCK_MESSAGES[activeTab] ?? []) : [];
  const hasPendingPermission = activeTab === "sess-003";

  useEffect(() => {
    if (activeTab === "sess-003") {
      const already = useStore
        .getState()
        .pendingPermissions.some((p) => p.sessionId === "sess-003");
      if (!already) {
        addPendingPermission({
          ...MOCK_PENDING_PERMISSION,
          sessionId: "sess-003",
          resolve: () => {},
        });
      }
    }
    // Also add a pending permission for sess-004 to show the blue dot
    const has004 = useStore
      .getState()
      .pendingPermissions.some((p) => p.sessionId === "sess-004");
    if (!has004) {
      addPendingPermission({
        ...MOCK_PENDING_PERMISSION,
        sessionId: "sess-004",
        resolve: () => {},
      });
    }
  }, [activeTab, addPendingPermission]);

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
            <div className="mx-auto max-w-[680px] w-full px-4 md:px-6 flex flex-col gap-1.5 mb-2">
              {/* Bash command approval */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#0f62fe] shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary shrink-0">
                    Bash
                  </span>
                  <code className="text-[11px] font-mono text-foreground/80 truncate flex-1 min-w-0">
                    npm run db:migrate --env production
                  </code>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      className="h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors"
                      onClick={() => setActiveTab("sess-001")}
                    >
                      Allow once
                    </button>
                    <button
                      className="h-6 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                      onClick={() => setActiveTab("sess-001")}
                    >
                      Always
                    </button>
                    <button
                      className="h-6 px-2 rounded-md text-[11px] font-medium text-destructive/70 hover:text-destructive transition-colors"
                      onClick={() => setActiveTab("sess-001")}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              </div>
              {/* File write approval */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#0f62fe] shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary shrink-0">
                    Write
                  </span>
                  <code className="text-[11px] font-mono text-foreground/80 truncate flex-1 min-w-0">
                    src/middleware/auth.ts
                  </code>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      className="h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors"
                      onClick={() => setActiveTab("sess-001")}
                    >
                      Allow once
                    </button>
                    <button
                      className="h-6 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                      onClick={() => setActiveTab("sess-001")}
                    >
                      Always
                    </button>
                    <button
                      className="h-6 px-2 rounded-md text-[11px] font-medium text-destructive/70 hover:text-destructive transition-colors"
                      onClick={() => setActiveTab("sess-001")}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              </div>
              {/* Network/egress approval */}
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
                    <button
                      className="h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors"
                      onClick={() => setActiveTab("sess-001")}
                    >
                      Allow once
                    </button>
                    <button
                      className="h-6 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                      onClick={() => setActiveTab("sess-001")}
                    >
                      Allow host
                    </button>
                    <button
                      className="h-6 px-2 rounded-md text-[11px] font-medium text-destructive/70 hover:text-destructive transition-colors"
                      onClick={() => setActiveTab("sess-001")}
                    >
                      Deny
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

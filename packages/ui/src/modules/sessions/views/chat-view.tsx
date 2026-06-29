import { SessionMode, type SessionView } from "api-server-api";
import {
  Check,
  CheckCheck,
  Globe,
  Settings2,
  ShieldOff,
  X,
} from "lucide-react";
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
import { ComponentShowcase } from "../components/component-showcase.js";
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

  const [viewMode, setViewMode] = useState<"chat" | "terminal">("chat");

  const [logsTearsheet, setLogsTearsheet] = useState<{
    sessionId: string;
    title: string;
  } | null>(null);
  const [showShowcase, setShowShowcase] = useState(() =>
    new URLSearchParams(window.location.search).has("showcase"),
  );

  const sessions: SessionView[] = useMemo(
    () => [
      // Active session (selected/opened)
      {
        sessionId: "sess-001",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-17T09:00:00Z",
        title: "Refactor auth to JWT",
        updatedAt: "2026-06-17T10:00:00Z",
      },
      // Default read state
      {
        sessionId: "sess-002",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-17T08:00:00Z",
        title: "Fix analytics N+1 query",
        updatedAt: "2026-06-17T09:30:00Z",
      },
      // Unread (bold title)
      {
        sessionId: "sess-003",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-17T07:00:00Z",
        title: "Mutate parent candidate ‘p2p-1...",
        updatedAt: "2026-06-17T08:00:00Z",
      },
      // Working (animated dots)
      {
        sessionId: "sess-005",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-16T10:00:00Z",
        title: "Generate DB migration",
        updatedAt: "2026-06-16T11:00:00Z",
      },
      // Terminal mode
      {
        sessionId: "sess-term-001",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Terminal,
        createdAt: "2026-06-16T08:00:00Z",
        title: "Debug pod networking",
        updatedAt: "2026-06-16T08:30:00Z",
      },
      // Action required (pending approval)
      {
        sessionId: "sess-006",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-17T06:00:00Z",
        title: "Add composite index on events",
        updatedAt: "2026-06-17T07:00:00Z",
      },
      // Scheduled session
      {
        sessionId: "sess-sched-001",
        agentId: selectedAgent ?? "",
        type: "schedule_cron",
        mode: SessionMode.Chat,
        createdAt: "2026-06-16T06:00:00Z",
        title: "Nightly test sweep",
        updatedAt: "2026-06-16T06:12:00Z",
        scheduleId: "sched-001",
      },
      // Scheduled + Action required
      {
        sessionId: "sess-sched-002",
        agentId: selectedAgent ?? "",
        type: "schedule_cron",
        mode: SessionMode.Chat,
        createdAt: "2026-06-16T05:00:00Z",
        title: "Dependency audit",
        updatedAt: "2026-06-16T05:30:00Z",
        scheduleId: "sched-002",
      },
      // Showcase — all component types
      {
        sessionId: "sess-showcase",
        agentId: selectedAgent ?? "",
        type: "regular",
        mode: SessionMode.Chat,
        createdAt: "2026-06-28T10:00:00Z",
        title: "Setup notifications table + API",
        updatedAt: "2026-06-28T11:00:00Z",
      },
    ],
    [selectedAgent],
  );
  const sessionsLoading = false;
  const refetchSessions = useCallback(() => {}, []);
  const [activeTab, setActiveTab] = useState<string | null>("sess-001");

  const messages = activeTab ? (MOCK_MESSAGES[activeTab] ?? []) : [];
  const hasPendingPermission = pendingPermissions.some(
    (p) => p.sessionId === activeTab,
  );

  useEffect(() => {
    const state = useStore.getState();
    const actionRequiredSessions = ["sess-006", "sess-sched-002", "sess-term-001"];
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
        viewMode={viewMode}
        onViewModeChange={setViewMode}
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

        {/* Center: Chat messages + input (or Terminal) */}
        <div className="relative flex flex-1 flex-col min-w-0">
          {viewMode === "terminal" && hasPendingPermission && (
            <div className="absolute top-3 right-3 z-30 w-[360px] flex flex-col gap-2 animate-in slide-in-from-top-2">
              {/* Floating approval: registry.npmjs.org */}
              <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-2.5 shadow-lg">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-foreground">
                    registry.npmjs.org
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                    GET /express/latest
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                    >
                      <Check size={12} /> Allow once
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                    >
                      <CheckCheck size={12} /> Allow permanently
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X size={12} /> Dismiss
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <ShieldOff size={12} /> Deny forever
                    </button>
                  </div>
                </div>
              </div>
              {/* Floating approval: api.github.com */}
              <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-2.5 shadow-lg">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-foreground">
                    api.github.com
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                    POST /repos/acme/app/pulls
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                    >
                      <Check size={12} /> Allow once
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                    >
                      <CheckCheck size={12} /> Allow permanently
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X size={12} /> Dismiss
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <ShieldOff size={12} /> Deny forever
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {viewMode === "terminal" ? (
            <TerminalMockup />
          ) : (
            <>
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
                <div className="px-4 md:px-8">
                  <div className="mx-auto max-w-[680px] flex flex-col gap-3 mb-3">
                    {/* ext_authz: Network egress — full card */}
                    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex flex-col gap-2.5">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-foreground">
                          registry.npmjs.org
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                          GET /express/latest
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                          >
                            <Check size={12} /> Allow once
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                          >
                            <CheckCheck size={12} /> Allow permanently
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted min-w-0"
                          >
                            <Globe size={12} />
                            <span className="truncate">
                              Allow registry.npmjs.org
                            </span>
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <X size={12} /> Dismiss
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <ShieldOff size={12} /> Deny forever
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Settings2 size={12} /> Customize…
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* ext_authz: POST egress — full card */}
                    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex flex-col gap-2.5">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-foreground">
                          api.github.com
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                          POST /repos/acme/app/pulls
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                          >
                            <Check size={12} /> Allow once
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                          >
                            <CheckCheck size={12} /> Allow permanently
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted min-w-0"
                          >
                            <Globe size={12} />
                            <span className="truncate">
                              Allow api.github.com
                            </span>
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <X size={12} /> Dismiss
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <ShieldOff size={12} /> Deny forever
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Settings2 size={12} /> Customize…
                          </button>
                        </div>
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
            </>
          )}
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
      {showShowcase && (
        <ComponentShowcase onClose={() => setShowShowcase(false)} />
      )}
      <button
        onClick={() => setShowShowcase(true)}
        className="fixed bottom-5 right-5 z-40 h-9 px-3 rounded-full bg-foreground text-background text-[12px] font-medium shadow-lg hover:opacity-90 transition-opacity"
      >
        Components
      </button>
    </div>
  );
}

function TerminalMockup() {
  return (
    <div className="flex-1 flex flex-col bg-[#0c0a09] overflow-hidden p-1">
      <div
        className="flex-1 overflow-y-auto px-3 py-2"
        style={{
          fontFamily:
            "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
          fontSize: 14,
          lineHeight: 1.4,
          color: "#e7e5e4",
        }}
      >
        <div style={{ color: "#78716c" }}>Session: refactor-auth-jwt</div>
        <div style={{ color: "#78716c" }}>Agent: claude-code-01</div>
        <div className="mt-3">
          <span style={{ color: "#22c55e" }}>~/project</span>
          <span style={{ color: "#e7e5e4" }}> $ </span>
          <span style={{ color: "#e7e5e4" }}>cat src/middleware/auth.ts</span>
        </div>
        <pre
          className="mt-1 whitespace-pre-wrap"
          style={{ color: "#a8a29e" }}
        >
          {`import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}`}
        </pre>
        <div className="mt-3">
          <span style={{ color: "#22c55e" }}>~/project</span>
          <span style={{ color: "#e7e5e4" }}> $ </span>
          <span style={{ color: "#e7e5e4" }}>
            mise run test -- packages/api-server
          </span>
        </div>
        <pre
          className="mt-1 whitespace-pre-wrap"
          style={{ color: "#a8a29e" }}
        >
          {` ✓ auth.test.ts (3 tests)
   ✓ verifies valid JWT
   ✓ rejects expired token
   ✓ rejects missing token

 Tests  3 passed (3)
 Duration  0.8s`}
        </pre>
        <div className="mt-3">
          <span style={{ color: "#22c55e" }}>~/project</span>
          <span style={{ color: "#e7e5e4" }}> $ </span>
          <span style={{ color: "#e7e5e4" }}>git diff --stat</span>
        </div>
        <pre
          className="mt-1 whitespace-pre-wrap"
          style={{ color: "#a8a29e" }}
        >
          {` src/middleware/auth.ts    | 24 ++++++++++++++----------
 src/routes/login.ts      |  8 ++++++--
 src/middleware/refresh.ts | 18 ++++++++++++++++++
 3 files changed, 38 insertions(+), 12 deletions(-)`}
        </pre>
        <div className="mt-3">
          <span style={{ color: "#22c55e" }}>~/project</span>
          <span style={{ color: "#e7e5e4" }}> $ </span>
          <span className="anim-blink" style={{ color: "#e7e5e4" }}>
            ▊
          </span>
        </div>
      </div>
    </div>
  );
}

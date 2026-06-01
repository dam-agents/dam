import { SessionMode } from "api-server-api";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  FileText as FileIcon,
  MessageSquare,
  RefreshCw,
  Settings2,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { api } from "../../../api.js";
import { Markdown } from "../../../components/markdown.js";
import { ResizeHandle } from "../../../components/resize-handle.js";
import { StatusBadge } from "../../../components/status-indicator.js";
import { isMobile } from "../../../lib/breakpoints.js";
import { queryClient } from "../../../query-client.js";
import type { SessionError } from "../../../store.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { FilesPanel } from "../../files/components/files-panel.js";
import { useFileTree } from "../../files/hooks/use-file-tree.js";
import { prefetchSchedules } from "../../schedules/api/queries.js";
import { acpSessionsKeys } from "../api/queries.js";
import { ChatInput } from "../components/chat-input.js";
import { ConfigurationPanel } from "../components/configuration-panel.js";
import { LogPanel } from "../components/log-panel.js";
import { PermissionPrompt } from "../components/permission-prompt.js";
import { SessionConfigBar } from "../components/session-config-popover.js";
import { SessionsSidebar } from "../components/sessions-sidebar.js";
import { Terminal } from "../components/terminal.js";
import { ThoughtBlock } from "../components/thought-block.js";
import { ToolChip } from "../components/tool-chip.js";
import { useAcpSession } from "../hooks/use-acp-session.js";

export function ChatView() {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const { data: agentsData } = useAgents();
  const agents = agentsData?.list ?? [];
  const selectedAgentName =
    agents.find((a) => a.id === selectedAgent)?.name ?? selectedAgent;
  const sessionId = useStore((s) => s.sessionId);
  const sessionMode = useStore((s) => s.sessionMode);
  const setSessionMode = useStore((s) => s.setSessionMode);
  const setSessionId = useStore((s) => s.setSessionId);
  const messages = useStore((s) => s.messages);
  const sessionError = useStore((s) => s.sessionError);
  const setSessionError = useStore((s) => s.setSessionError);
  const deleteSession = useStore((s) => s.deleteSession);
  const rightTab = useStore((s) => s.rightTab);
  const goBack = useStore((s) => s.goBack);
  const setRightTab = useStore((s) => s.setRightTab);
  const hasPendingPermission = useStore((s) =>
    s.sessionId
      ? s.pendingPermissions.some((p) => p.sessionId === s.sessionId)
      : false,
  );
  const mobileScreen = useStore((s) => s.mobileScreen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const showMobilePanel = useStore((s) => s.showMobilePanel);
  const setShowMobilePanel = useStore((s) => s.setShowMobilePanel);
  const terminalPaused = useStore((s) => s.terminalPaused);
  const setTerminalPaused = useStore((s) => s.setTerminalPaused);

  const [leftW, setLeftW] = useState(
    () => Number(localStorage.getItem("platform-left-w")) || 220,
  );
  const [rightW, setRightW] = useState(
    () => Number(localStorage.getItem("platform-right-w")) || 340,
  );
  // Ref (not state) so the chat→terminal toggle propagates to Terminal's mount
  // synchronously — zustand re-renders before useState commits.
  const terminalFreshRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Hooks ──
  const {
    ensureConnection,
    resetSession,
    resumeSession,
    sendPrompt,
    stopAgent,
    busy,
    engagedSessionIdRef,
    loadingSession,
  } = useAcpSession(selectedAgent, textareaRef);

  const { openFileHandler } = useFileTree(selectedAgent);

  // ── Scroll management ──
  // Single source of truth: `stickRef` — "should we pin to the bottom?".
  // Scroll events are the ONLY thing that flip it (user intent). ResizeObserver
  // reacts to viewport shrinks (ChatInput grows) and content growth (streaming
  // tokens) by re-pinning — it never toggles stick itself.
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const inner = el.firstElementChild;

    const THRESHOLD = 30;
    const nearBottom = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD;

    const onScroll = () => {
      const near = nearBottom();
      stickRef.current = near;
      setShowJump(!near);
    };

    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });

    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    if (inner) ro.observe(inner);
    onScroll();

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  const mobileResumeSession = useCallback(
    (sid: string, mode?: SessionMode) => {
      setMobileScreen("chat");
      setSessionMode(mode ?? SessionMode.Chat);
      // Terminal sessions don't use ACP.
      if (mode === SessionMode.Terminal) setSessionId(sid);
      else resumeSession(sid);
    },
    [setMobileScreen, setSessionMode, setSessionId, resumeSession],
  );

  const handleNewSession = useCallback(() => {
    if (!sessionId && messages.length === 0) {
      setMobileScreen("chat");
      return;
    }
    setSessionMode(SessionMode.Chat);
    resetSession();
    setMobileScreen("chat");
  }, [
    sessionId,
    messages.length,
    resetSession,
    setMobileScreen,
    setSessionMode,
  ]);

  const showConfirm = useStore((s) => s.showConfirm);
  const handleToggleMode = useCallback(async () => {
    if (!selectedAgent) return;
    const target =
      sessionMode === SessionMode.Terminal
        ? SessionMode.Chat
        : SessionMode.Terminal;

    // Blank chat → terminal: spawn a fresh terminal session with no confirmation.
    if (!sessionId && messages.length === 0) {
      if (target === SessionMode.Terminal) {
        const newSessionId = crypto.randomUUID();
        await api.sessions.create.mutate({
          sessionId: newSessionId,
          agentId: selectedAgent,
          mode: SessionMode.Terminal,
        });
        queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
        setSessionId(newSessionId);
      }
      setSessionMode(target);
      return;
    }

    if (
      !(await showConfirm(
        `Switch this session to ${target} mode? Files and history are preserved, but any running tasks will be cancelled.`,
        "Switch session mode",
      ))
    )
      return;

    if (busy) stopAgent();
    if (target === SessionMode.Terminal) {
      terminalFreshRef.current = true;
      setTerminalPaused(true);
      setSessionMode(target);
    }
    if (sessionId) {
      if (target !== SessionMode.Terminal) setSessionMode(target);
      try {
        await api.sessions.setMode.mutate({
          sessionId,
          agentId: selectedAgent,
          mode: target,
        });
        queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
      } catch {
        setSessionMode(sessionMode);
        if (target === SessionMode.Terminal) setTerminalPaused(false);
        useStore.getState().showToast({
          kind: "error",
          message: "Failed to switch session mode",
        });
        return;
      }
      if (target === SessionMode.Terminal) setTerminalPaused(false);
    } else {
      setSessionMode(target);
    }
    if (target === SessionMode.Chat) {
      if (sessionId) resumeSession(sessionId);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [
    selectedAgent,
    sessionMode,
    sessionId,
    messages.length,
    showConfirm,
    busy,
    stopAgent,
    setSessionMode,
    resumeSession,
    setSessionId,
    setTerminalPaused,
  ]);

  const handleBack = useCallback(() => {
    if (isMobile() && mobileScreen === "chat") {
      setMobileScreen("sessions");
      return;
    }
    resetSession();
    goBack();
  }, [mobileScreen, setMobileScreen, resetSession, goBack]);

  const chatActive = (sessionMode ?? SessionMode.Chat) === SessionMode.Chat;

  // ── Right panel ──
  const rightTabs = ["files", "log", "configuration"] as const;
  const rightPanelContent = (
    <>
      <div className="flex border-b border-border-light shrink-0">
        {rightTabs.map((tab) => {
          const warmCache =
            tab === "configuration" && selectedAgent
              ? () => prefetchSchedules(selectedAgent)
              : undefined;
          return (
            <button
              key={tab}
              onClick={() => setRightTab(tab)}
              onMouseEnter={warmCache}
              onFocus={warmCache}
              className={`flex-1 h-11 text-[11px] font-bold uppercase tracking-[0.05em] border-b-2 transition-colors ${rightTab === tab ? "text-accent border-accent bg-accent-light" : "text-text-muted border-transparent hover:text-text-secondary"}`}
            >
              {tab === "configuration" ? "config" : tab}
            </button>
          );
        })}
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        {rightTab === "files" && <FilesPanel onOpenFile={openFileHandler} />}
        {rightTab === "log" && <LogPanel />}
        <div
          className={`flex flex-1 flex-col overflow-hidden ${rightTab === "configuration" ? "" : "hidden"}`}
        >
          <ConfigurationPanel
            onResumeSession={mobileResumeSession}
            agentId={selectedAgent}
            agentRunning={
              agents.find((a) => a.id === selectedAgent)?.state === "running"
            }
            onOpenFile={openFileHandler}
          />
        </div>
      </div>
    </>
  );

  // ── Layout ──
  return (
    <div className="flex h-dvh bg-bg relative overflow-hidden">
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />

      {/* Left: Sessions */}
      <div
        style={{ width: leftW }}
        className={`shrink-0 flex flex-col border-r border-border-light bg-surface/50 backdrop-blur-xl overflow-hidden relative z-10 ${
          mobileScreen === "chat" ? "hidden md:flex" : "flex"
        } ${mobileScreen === "sessions" ? "max-md:!w-full" : ""}`}
      >
        <SessionsSidebar
          onResumeSession={mobileResumeSession}
          onNewSession={handleNewSession}
        />
      </div>
      <ResizeHandle
        side="left"
        onResize={(d) =>
          setLeftW((w) => {
            const v = Math.max(140, Math.min(400, w + d));
            localStorage.setItem("platform-left-w", String(v));
            return v;
          })
        }
      />

      {/* Main chat column */}
      <div
        className={`relative flex flex-1 flex-col min-w-0 ${mobileScreen === "sessions" ? "hidden md:flex" : "flex"}`}
      >
        {/* Header */}
        <header className="flex items-center gap-4 px-5 h-11 border-b border-border-light bg-surface/50 backdrop-blur-xl shrink-0">
          <button
            className="flex items-center gap-1 text-[13px] font-medium text-text-secondary hover:text-accent transition-colors"
            onClick={handleBack}
          >
            <ArrowLeft size={14} />
            <span className="hidden md:inline">Agents</span>
          </button>
          <span className="w-px h-4 bg-border-light" />
          <h1 className="text-[14px] font-bold text-text truncate">
            {selectedAgentName}
          </h1>
          <div className="flex h-7 rounded-md border border-border-light overflow-hidden">
            <button
              className={`px-2 flex items-center gap-1 text-[11px] font-semibold transition-colors ${chatActive ? "bg-accent-light text-accent" : "text-text-muted hover:text-accent"}`}
              onClick={chatActive ? undefined : handleToggleMode}
              title="Chat mode"
            >
              <MessageSquare size={12} /> Chat
            </button>
            <button
              className={`px-2 flex items-center gap-1 text-[11px] font-semibold border-l border-border-light transition-colors ${!chatActive ? "bg-accent-light text-accent" : "text-text-muted hover:text-accent"}`}
              onClick={!chatActive ? undefined : handleToggleMode}
              title="Terminal mode"
            >
              <TerminalSquare size={12} /> Terminal
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="md:hidden h-7 w-7 rounded-md border border-border-light flex items-center justify-center text-text-muted hover:text-accent hover:border-accent transition-colors"
              onClick={() => setShowMobilePanel(true)}
            >
              <Settings2 size={14} />
            </button>
            <ChatHeaderStatus
              selectedAgent={selectedAgent}
              agents={agents}
              busy={busy}
            />
          </div>
        </header>

        {/* Content: Terminal or Chat */}
        {sessionMode === SessionMode.Terminal && selectedAgent && sessionId ? (
          <Terminal
            key={sessionId}
            agentId={selectedAgent}
            sessionId={sessionId}
            fresh={terminalFreshRef.current}
            autoConnect={!terminalPaused}
            onConnected={() => {
              terminalFreshRef.current = false;
              setTerminalPaused(false);
            }}
          />
        ) : (
          <>
            <div className="relative flex flex-1 flex-col min-h-0">
              <div ref={messagesRef} className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-[760px] px-4 md:px-8 py-8 flex flex-col gap-6">
                  {loadingSession && (
                    <div className="py-20 flex items-center justify-center gap-3 text-[14px] text-text-muted">
                      <span className="w-5 h-5 rounded-full border-2 border-border-light border-t-accent anim-spin" />
                      Loading session...
                    </div>
                  )}
                  {!loadingSession && sessionError && (
                    <SessionErrorCard
                      error={sessionError}
                      onBack={() => {
                        setSessionError(null);
                        resetSession();
                        if (isMobile()) setMobileScreen("sessions");
                      }}
                      onDelete={async () => {
                        const sid = sessionError.sessionId;
                        setSessionError(null);
                        await deleteSession(sid);
                        if (isMobile()) setMobileScreen("sessions");
                      }}
                    />
                  )}
                  {!loadingSession &&
                    !sessionError &&
                    messages.length === 0 && (
                      <div className="py-24 text-center">
                        <p className="text-[16px] font-bold text-text mb-2">
                          Start a conversation
                        </p>
                        <p className="text-[14px] text-text-muted">
                          Send a message to begin a new session with this agent
                        </p>
                      </div>
                    )}
                  {messages.map((m) =>
                    m.notice ? (
                      <div key={m.id} className="flex justify-center anim-in">
                        <span className="text-[11px] italic text-text-muted px-3 py-1 border-t border-b border-border-light/60">
                          {m.parts.find((p) => p.kind === "text")?.kind ===
                          "text"
                            ? (
                                m.parts.find((p) => p.kind === "text") as {
                                  text: string;
                                }
                              ).text
                            : "…"}
                        </span>
                      </div>
                    ) : (
                      <div
                        key={m.id}
                        className={`flex flex-col gap-1 anim-in ${m.role === "user" ? "items-end" : "items-start"}`}
                      >
                        <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted mb-0.5">
                          {m.role === "user" ? "You" : "Agent"}
                        </span>
                        {m.error ? (
                          <SendErrorCard
                            error={m.error.message}
                            onRetry={
                              m.error.retryWith
                                ? () =>
                                    sendPrompt(
                                      m.error!.retryWith!.text,
                                      m.error!.retryWith!.attachments,
                                    )
                                : undefined
                            }
                          />
                        ) : (
                          <div
                            className={
                              m.role === "user"
                                ? "flex flex-col gap-2 rounded-xl rounded-br-sm border border-accent/30 bg-accent-light px-5 py-3 text-[14px] text-text max-w-[620px]"
                                : "flex flex-col gap-2 max-w-full"
                            }
                          >
                            {m.parts.map((p, i) =>
                              p.kind === "text" ? (
                                m.role === "assistant" ? (
                                  <Markdown
                                    key={i}
                                    onFileClick={openFileHandler}
                                  >
                                    {p.text}
                                  </Markdown>
                                ) : (
                                  <span
                                    key={i}
                                    className="whitespace-pre-wrap break-words"
                                  >
                                    {p.text}
                                    {m.streaming &&
                                      i === m.parts.length - 1 && (
                                        <span className="inline-block w-[7px] h-4 bg-accent ml-0.5 align-text-bottom anim-blink rounded-sm" />
                                      )}
                                  </span>
                                )
                              ) : p.kind === "thought" ? (
                                <ThoughtBlock
                                  key={i}
                                  text={p.text}
                                  streaming={m.streaming}
                                />
                              ) : p.kind === "image" ? (
                                <img
                                  key={i}
                                  src={`data:${p.mimeType};base64,${p.data}`}
                                  alt="image"
                                  className="max-w-[400px] max-h-[400px] rounded-lg border border-border-light object-contain"
                                />
                              ) : p.kind === "file" ? (
                                <div
                                  key={i}
                                  className="inline-flex items-center gap-2 rounded-md border border-border-light bg-surface-raised px-3 py-2"
                                >
                                  <FileIcon
                                    size={14}
                                    className="text-text-muted shrink-0"
                                  />
                                  <span className="text-[12px] text-text-secondary">
                                    {p.name}
                                  </span>
                                  {p.size !== undefined && (
                                    <span className="text-[10px] text-text-muted">
                                      {p.size < 1024
                                        ? `${p.size} B`
                                        : `${(p.size / 1024).toFixed(1)} KB`}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <ToolChip key={i} chip={p} />
                              ),
                            )}
                            {m.streaming &&
                              m.parts.length === 0 &&
                              (m.queued ? (
                                <span className="text-[12px] text-text-muted italic">
                                  Waiting for previous prompt…
                                </span>
                              ) : (
                                <span className="inline-block w-[7px] h-4 bg-accent anim-blink rounded-sm" />
                              ))}
                          </div>
                        )}
                      </div>
                    ),
                  )}
                </div>
              </div>

              {showJump && (
                <button
                  onClick={scrollToBottom}
                  className="absolute left-1/2 -translate-x-1/2 bottom-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-border-light bg-surface-raised px-3 py-1.5 text-[12px] text-text-secondary shadow-md hover:text-accent hover:border-accent transition-colors"
                >
                  <ArrowDown size={12} />
                  Jump to latest
                </button>
              )}
            </div>

            {hasPendingPermission ? (
              <PermissionPrompt />
            ) : (
              <ChatInput
                textareaRef={textareaRef}
                busy={busy}
                loadingSession={loadingSession}
                onSend={sendPrompt}
                onStop={stopAgent}
                footer={
                  !loadingSession && (
                    <SessionConfigBar
                      ensureConnection={ensureConnection}
                      engagedSessionIdRef={engagedSessionIdRef}
                      agentId={selectedAgent ?? ""}
                    />
                  )
                }
              />
            )}
          </>
        )}
      </div>

      {/* Right panel: desktop */}
      <ResizeHandle
        side="right"
        onResize={(d) =>
          setRightW((w) => {
            const v = Math.max(240, Math.min(600, w + d));
            localStorage.setItem("platform-right-w", String(v));
            return v;
          })
        }
      />
      <div
        style={{ width: rightW }}
        className="hidden md:flex shrink-0 flex-col border-l border-border-light bg-surface/50 backdrop-blur-xl overflow-hidden relative z-10"
      >
        {rightPanelContent}
      </div>

      {/* Right panel: mobile overlay */}
      {showMobilePanel && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowMobilePanel(false)}
          />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-[400px] bg-surface flex flex-col anim-slide-in-right">
            <div className="flex items-center justify-between px-4 h-11 border-b border-border-light shrink-0">
              <span className="text-[13px] font-bold text-text">Panel</span>
              <button
                className="h-7 w-7 rounded-md border border-border-light flex items-center justify-center text-text-muted hover:text-accent hover:border-accent transition-colors"
                onClick={() => setShowMobilePanel(false)}
              >
                <ArrowLeft size={14} />
              </button>
            </div>
            {rightPanelContent}
          </div>
        </div>
      )}
    </div>
  );
}

/** Small pill in the chat header. Falls through to the shared `StatusBadge`,
 *  overriding to a "Busy" variant while the agent is mid-turn. */
function ChatHeaderStatus({
  selectedAgent,
  agents,
  busy,
}: {
  selectedAgent: string | null;
  agents: AgentView[];
  busy: boolean;
}) {
  if (busy) {
    return (
      <StatusBadge
        size="sm"
        label="Busy"
        colorClasses="bg-accent-light text-accent border-accent"
        dotColorClasses="bg-accent anim-pulse"
      />
    );
  }
  const agent = agents.find((a) => a.id === selectedAgent);
  return <StatusBadge size="sm" state={agent?.state ?? "starting"} />;
}

function SessionErrorCard({
  error,
  onBack,
  onDelete,
}: {
  error: SessionError;
  onBack: () => void;
  onDelete: () => void;
}) {
  const title =
    error.kind === "not-found"
      ? "Session not found"
      : error.kind === "connection"
        ? "Can't reach the agent"
        : "Failed to load session";
  return (
    <div className="my-4 rounded-xl border-2 border-danger bg-danger-light p-5 flex flex-col gap-3 anim-in">
      <div className="flex items-start gap-3">
        <AlertCircle size={20} className="text-danger shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-bold text-text mb-1">{title}</h3>
          <p className="text-[13px] text-text-secondary break-words">
            {error.message}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft size={12} /> Back to sessions
        </Button>
        {error.kind === "not-found" && (
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 size={12} /> Delete orphaned session
          </Button>
        )}
      </div>
    </div>
  );
}

function SendErrorCard({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="rounded-xl border-2 border-danger bg-danger-light px-4 py-3 flex items-start gap-2.5 max-w-[620px]"
      role="alert"
    >
      <AlertCircle size={16} className="text-danger shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="text-[13px] text-text break-words">
          <span className="font-bold text-danger">Send failed:</span> {error}
        </div>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="self-start"
          >
            <RefreshCw size={11} /> Retry
          </Button>
        )}
      </div>
    </div>
  );
}

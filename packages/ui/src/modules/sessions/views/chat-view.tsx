import { ArrowDown, Settings } from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import {
  AlertCircle,
  ArrowLeft,
  FileText as FileIcon,
  MoreVertical,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { Markdown } from "../../../components/markdown.js";
import { ResizeHandle } from "../../../components/resize-handle.js";
import { StatusBadge } from "../../../components/status-indicator.js";
import { isMobile } from "../../../lib/breakpoints.js";
import { queryClient } from "../../../query-client.js";
import type { SessionError } from "../../../store.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useHarnessConfigCurrent } from "../../agents/api/harness-config.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import { useAgents, useIsAgentOperable } from "../../agents/api/queries.js";
import { AgentUnavailableOverlay } from "../../agents/components/agent-unavailable-overlay.js";
import { ContributionFailuresBadge } from "../../agents/components/contribution-failures-badge.js";
import { useAgentReachabilityProbe } from "../../agents/hooks/use-agent-reachability-probe.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "../../agents/hooks/use-restart-agent.js";
import { resolveAgentDisplay } from "../../agents/utils/agent-resolver.js";
import { EgressApprovalToasts } from "../../approvals/components/egress-approval-toasts.js";
import { DockedFilePanel } from "../../files/components/docked-file-panel.js";
import { FilesPanel } from "../../files/components/files-panel.js";
import { ImportInProgressBadge } from "../../files/components/import-in-progress-badge.js";
import { useFileTree } from "../../files/hooks/use-file-tree.js";
import {
  acpSessionsKeys,
  optimisticInsertSession,
  setSessionRunning,
} from "../api/queries.js";
import { BusyIndicator } from "../components/busy-indicator.js";
import { ChatColumn } from "../components/chat-column.js";
import { ChatInputArea } from "../components/chat-input-area.js";
import {
  PermissionStatusLine,
  PermissionVerdictLine,
} from "../components/permission-prompt.js";
import { SessionsSidebar } from "../components/sessions-sidebar.js";
import { TempConfigDialog } from "../components/temp-config-dialog.js";
import { Terminal } from "../components/terminal.js";
import { ThoughtBlock } from "../components/thought-block.js";
import { ToolChip } from "../components/tool-chip.js";
import type { ConnectionState } from "../hooks/use-acp-connection.js";
import { useAcpSession } from "../hooks/use-acp-session.js";
import { useHasPendingPermission } from "../hooks/use-pending-permissions.js";

export function ChatView() {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const { data: agentsData } = useAgents();
  const agents = agentsData?.list ?? [];
  const agentOperable = useIsAgentOperable(selectedAgent);

  useSyncRestartingAgents();
  useAgentReachabilityProbe(selectedAgent);
  const restartingAgents = useStore((s) => s.restartingAgents);
  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const agentView = agents.find((a) => a.id === selectedAgent) ?? null;
  const agentDisplay = agentView
    ? resolveAgentDisplay(agentView, restartingIds)
    : null;
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
  const openFilePath = useStore((s) => s.openFilePath);
  const goBack = useStore((s) => s.goBack);
  const navigateToSandboxSettings = useStore(
    (s) => s.navigateToSandboxSettings,
  );
  const setView = useStore((s) => s.setView);
  const filesSectionOpen = useStore((s) => s.filesSectionOpen);
  const setFilesSectionOpen = useStore((s) => s.setFilesSectionOpen);
  const hasPendingPermission = useHasPendingPermission();
  const mobileScreen = useStore((s) => s.mobileScreen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const terminalPaused = useStore((s) => s.terminalPaused);
  const setTerminalPaused = useStore((s) => s.setTerminalPaused);

  const [leftW, setLeftW] = useState(
    () => Number(localStorage.getItem("platform-left-w")) || 220,
  );
  // null = no stored width yet: the file panel splits 50/50 with the chat
  // column until the user drags the divider.
  const [rightW, setRightW] = useState<number | null>(
    () => Number(localStorage.getItem("platform-right-w")) || null,
  );
  const filePanelRef = useRef<HTMLDivElement>(null);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [sessionsH, setSessionsH] = useState(
    () => Number(localStorage.getItem("platform-sessions-h")) || 260,
  );
  // Ref (not state) so the chat→terminal toggle propagates to Terminal's mount
  // synchronously — zustand re-renders before useState commits.
  const terminalFreshRef = useRef(false);
  const ephemeralTerminalIdRef = useRef<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Hooks ──
  const {
    resetSession,
    resumeSession,
    sendPrompt,
    stopAgent,
    busy,
    loadingSession,
    connectionState,
  } = useAcpSession(selectedAgent, textareaRef);

  const { openFileHandler } = useFileTree(selectedAgent);
  const { restart } = useRestartAgent();
  const deleteAgent = useDeleteAgent();
  const { data: harnessCurrent } = useHarnessConfigCurrent(selectedAgent);

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

  useEffect(() => {
    if (messages.length === 0) {
      stickRef.current = true;
      setShowJump(false);
    }
  }, [messages.length]);

  const pendingResumeSessionId = useStore((s) => s.pendingResumeSessionId);
  const setPendingResumeSessionId = useStore(
    (s) => s.setPendingResumeSessionId,
  );
  useEffect(() => {
    if (!selectedAgent || !pendingResumeSessionId) return;
    const sid = pendingResumeSessionId;
    setPendingResumeSessionId(null);
    resumeSession(sid);
  }, [
    selectedAgent,
    pendingResumeSessionId,
    setPendingResumeSessionId,
    resumeSession,
  ]);

  const mobileResumeSession = useCallback(
    (sid: string, mode?: SessionMode) => {
      setMobileScreen("chat");
      setSessionMode(mode ?? SessionMode.Chat);
      // Terminal sessions don't use ACP.
      if (mode === SessionMode.Terminal) {
        setSessionId(sid);
        return;
      }
      if (sid === sessionId) {
        scrollToBottom();
        return;
      }
      resumeSession(sid);
    },
    [
      sessionId,
      setMobileScreen,
      setSessionMode,
      setSessionId,
      resumeSession,
      scrollToBottom,
    ],
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

  // Spawn a fresh ephemeral terminal session. The PTY creates it — no server
  // registration; it surfaces in session/list with no `_meta` and decodes as
  // terminal.
  const handleNewTerminal = useCallback(() => {
    resetSession();
    const id = crypto.randomUUID();
    ephemeralTerminalIdRef.current = id;
    terminalFreshRef.current = true;
    setSessionId(id);
    setSessionMode(SessionMode.Terminal);
    setMobileScreen("chat");
  }, [resetSession, setSessionId, setSessionMode, setMobileScreen]);

  const handleConfigureSandbox = useCallback(() => {
    if (selectedAgent) navigateToSandboxSettings(selectedAgent);
  }, [selectedAgent, navigateToSandboxSettings]);

  const handleRestartSandbox = useCallback(() => {
    if (selectedAgent) restart(selectedAgent);
  }, [selectedAgent, restart]);

  const handleDeleteSandbox = useCallback(async () => {
    if (!selectedAgent) return;
    const ok = await showConfirm(
      "Delete this sandbox? This also deletes all persistent data and cannot be undone.",
      "Delete Sandbox",
      { kind: "destructive" },
    );
    if (!ok) return;
    deleteAgent.mutate({ id: selectedAgent });
    setView("list");
  }, [selectedAgent, showConfirm, deleteAgent, setView]);

  const handleBack = useCallback(() => {
    if (isMobile() && mobileScreen === "chat") {
      setMobileScreen("sessions");
      return;
    }
    resetSession();
    goBack();
  }, [mobileScreen, setMobileScreen, resetSession, goBack]);

  const dotColor =
    agentDisplay?.state === "running"
      ? "bg-emerald-500"
      : agentDisplay?.state === "error"
        ? "bg-red-500"
        : agentDisplay?.state === "hibernated"
          ? "bg-zinc-400"
          : "bg-amber-500";

  // The status line normally renders inside the last assistant message; when
  // the transcript ends on something else (replay edge), fall back to a
  // standalone trailing line so the blocked input always has its anchor.
  const lastMessage = messages[messages.length - 1];
  const statusLineInThread =
    lastMessage?.role === "assistant" && !lastMessage.notice;

  // ── Layout ──
  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      {/* Header spans the full width; on mobile it belongs to the chat screen only */}
      <header
        className={`${mobileScreen === "sessions" ? "hidden md:flex" : "flex"} items-center gap-3 px-6 h-[70px] border-b border-border-light shrink-0 relative z-10`}
      >
        <button
          className="md:hidden flex items-center gap-1 text-[13px] font-medium text-text-secondary hover:text-accent transition-colors"
          onClick={handleBack}
        >
          <ArrowLeft size={14} />
        </button>
        <div className="group flex items-center gap-3 min-w-0">
          <span
            aria-hidden
            className={cn("h-2 w-2 rounded-full shrink-0", dotColor)}
          />
          <h1 className="text-[14px] font-bold text-text truncate">
            {selectedAgentName}
          </h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Sandbox actions"
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreVertical size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={handleConfigureSandbox}>
                Configure sandbox
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleRestartSandbox}>
                Restart
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={handleDeleteSandbox}
              >
                Delete Sandbox
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Temporary access to the old right-panel content until #2124. */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowConfigDialog(true)}
            title="Sandbox configuration"
          >
            <Settings size={16} />
          </Button>
          <ChatHeaderStatus
            selectedAgent={selectedAgent}
            agents={agents}
            busy={busy}
            connectionState={connectionState}
          />
        </div>
      </header>

      {/* Body row: left panel | chat | right panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Sessions + Files sections */}
        <div
          style={{ width: leftW }}
          className={`shrink-0 flex flex-col border-r border-border-light overflow-hidden relative z-10 ${
            mobileScreen === "chat" ? "hidden md:flex" : "flex"
          } ${mobileScreen === "sessions" ? "max-md:!w-full" : ""}`}
        >
          <SessionsSidebar
            open={sessionsOpen}
            onToggle={() => setSessionsOpen((o) => !o)}
            className={
              !sessionsOpen
                ? "shrink-0"
                : filesSectionOpen
                  ? "shrink-0"
                  : "flex-1"
            }
            style={
              sessionsOpen && filesSectionOpen
                ? { height: sessionsH }
                : undefined
            }
            onResumeSession={mobileResumeSession}
            onNewSession={handleNewSession}
            onNewTerminal={handleNewTerminal}
          />
          {sessionsOpen && filesSectionOpen && (
            <ResizeHandle
              orientation="vertical"
              onResize={(d) =>
                setSessionsH((h) => {
                  const v = Math.max(120, Math.min(600, h + d));
                  localStorage.setItem("platform-sessions-h", String(v));
                  return v;
                })
              }
            />
          )}
          <FilesPanel
            open={filesSectionOpen}
            onToggle={() => setFilesSectionOpen(!filesSectionOpen)}
            className={filesSectionOpen ? "flex-1" : "shrink-0"}
            onOpenFile={openFileHandler}
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
          className={`relative flex flex-1 flex-col min-w-0 px-2 ${mobileScreen === "sessions" ? "hidden md:flex" : "flex"}`}
        >
          {/* Content: Terminal or Chat */}
          {sessionMode === SessionMode.Terminal &&
          selectedAgent &&
          sessionId ? (
            <Terminal
              key={sessionId}
              agentId={selectedAgent}
              sessionId={sessionId}
              fresh={terminalFreshRef.current}
              autoConnect={!terminalPaused && agentOperable}
              onConnected={() => {
                terminalFreshRef.current = false;
                setTerminalPaused(false);
              }}
              onFirstSubmit={() => {
                // Inserted running — onSubmit's seed can't land on a row that doesn't exist yet.
                optimisticInsertSession(
                  selectedAgent,
                  sessionId,
                  SessionMode.Terminal,
                  true,
                );
                queryClient.invalidateQueries({
                  queryKey: acpSessionsKeys.all,
                });
              }}
              // Optimistic working dots on Enter; the poll reconciles within 5s.
              onSubmit={() => setSessionRunning(selectedAgent, sessionId, true)}
            />
          ) : (
            <>
              <div className="relative flex flex-1 flex-col min-h-0">
                <div ref={messagesRef} className="flex-1 overflow-y-auto">
                  <ChatColumn className="px-4 md:px-4 py-8 flex flex-col gap-8">
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
                            Send a message to begin a new session with this
                            agent
                          </p>
                        </div>
                      )}
                    {messages.map((m, mi) =>
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
                          data-testid="chat-message"
                          data-role={m.role}
                          className={`flex flex-col gap-1 anim-in ${m.role === "user" ? "items-end" : "items-start"}`}
                        >
                          <span className="text-[11px] font-medium text-muted-foreground mb-0.5">
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
                                  ? "flex flex-col gap-2 rounded-xl border border-border-light bg-surface px-4 py-3 text-[14px] text-text"
                                  : "flex flex-col gap-4 w-full max-w-full"
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
                                ) : p.kind === "verdict" ? (
                                  <PermissionVerdictLine key={i} verdict={p} />
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
                                m.queued &&
                                m.parts.length === 0 && (
                                  <span className="text-[12px] text-text-muted italic">
                                    Waiting for previous prompt…
                                  </span>
                                )}
                              {m.role === "assistant" &&
                                mi === messages.length - 1 && (
                                  <PermissionStatusLine />
                                )}
                              {m.role === "assistant" &&
                                m.streaming &&
                                !m.queued &&
                                !hasPendingPermission && (
                                  <BusyIndicator className="py-1" />
                                )}
                            </div>
                          )}
                        </div>
                      ),
                    )}
                    {!statusLineInThread && <PermissionStatusLine />}
                  </ChatColumn>
                </div>

                {showJump && (
                  <button
                    onClick={scrollToBottom}
                    className="absolute left-1/2 -translate-x-1/2 bottom-3 z-20 inline-flex items-center gap-1.5 h-[35px] rounded-full border border-border-light bg-background px-3 text-[14px] font-normal text-text shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-muted transition-colors"
                  >
                    <ArrowDown size={16} />
                    Jump to latest
                  </button>
                )}
              </div>

              <div className="pb-[16px]">
                <ChatInputArea
                  textareaRef={textareaRef}
                  busy={busy}
                  loadingSession={loadingSession}
                  onSend={sendPrompt}
                  onStop={stopAgent}
                />
                {!hasPendingPermission && harnessCurrent?.model && (
                  <div className="px-4 md:px-8">
                    <ChatColumn>
                      <button
                        type="button"
                        onClick={handleConfigureSandbox}
                        title="Model — change in sandbox configuration"
                        className="flex items-center gap-1 pl-3 text-[14px] text-muted-foreground hover:text-text transition-colors"
                      >
                        {harnessCurrent.model}
                        <Settings size={12} />
                      </button>
                    </ChatColumn>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Docked file panel — hidden unless a file is open; fullscreen
            takeover on mobile */}
        {openFilePath && (
          <>
            <div className="hidden md:flex">
              <ResizeHandle
                side="right"
                onResize={(d) =>
                  setRightW((w) => {
                    const base = w ?? filePanelRef.current?.offsetWidth ?? 0;
                    const v = Math.max(240, Math.min(960, base + d));
                    localStorage.setItem("platform-right-w", String(v));
                    return v;
                  })
                }
              />
            </div>
            <div
              ref={filePanelRef}
              style={
                rightW !== null
                  ? ({ "--file-w": `${rightW}px` } as CSSProperties)
                  : undefined
              }
              className={cn(
                "flex flex-col overflow-hidden bg-background relative z-10 max-md:fixed max-md:inset-0 max-md:z-50",
                rightW !== null
                  ? "md:shrink-0 md:w-[var(--file-w)]"
                  : "md:flex-1 md:basis-0 md:min-w-0",
                "md:border-l md:border-border-light",
              )}
            >
              <DockedFilePanel onOpenFile={openFileHandler} />
            </div>
          </>
        )}
      </div>

      {showConfigDialog && (
        <TempConfigDialog
          agentId={selectedAgent}
          agentState={agents.find((a) => a.id === selectedAgent)?.state}
          sessionId={sessionId}
          onResumeSession={mobileResumeSession}
          onOpenFile={openFileHandler}
          onClose={() => setShowConfigDialog(false)}
        />
      )}

      <EgressApprovalToasts agentId={selectedAgent} />

      {selectedAgent && !agentOperable && (
        <AgentUnavailableOverlay
          agent={agentView}
          display={agentDisplay}
          name={selectedAgentName ?? ""}
          onBack={handleBack}
        />
      )}
    </div>
  );
}

/** Exceptional-state badges in the chat header — nothing renders while the
 *  agent is healthy. A transient WS hiccup on a still-running agent shows a
 *  "Reconnecting" pill; full lifecycle outages are handled by the takeover
 *  overlay, not here. */
function ChatHeaderStatus({
  selectedAgent,
  agents,
  busy,
  connectionState,
}: {
  selectedAgent: string | null;
  agents: AgentView[];
  busy: boolean;
  connectionState: ConnectionState;
}) {
  const agent = agents.find((a) => a.id === selectedAgent);
  const reconnecting =
    connectionState === "reconnecting" || connectionState === "reloading";
  return (
    <>
      {reconnecting && (
        <StatusBadge
          label="Reconnecting"
          colorClasses="bg-warning-light text-warning border-warning"
        />
      )}
      <ImportInProgressBadge agentId={selectedAgent} />
      {!busy && agent && (
        <ContributionFailuresBadge failures={agent.contributionFailures} />
      )}
    </>
  );
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

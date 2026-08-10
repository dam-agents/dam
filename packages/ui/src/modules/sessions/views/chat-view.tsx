import {
  ArrowDown,
  ArrowLeft,
  OverflowMenuVertical,
  Settings,
  TrashCan,
  Warning,
} from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { stateDotClass } from "@/components/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ResizeHandle } from "../../../components/resize-handle.js";
import { isMobile } from "../../../lib/breakpoints.js";
import { queryClient } from "../../../query-client.js";
import type { SessionError } from "../../../store.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useHarnessConfigCurrent } from "../../agents/api/harness-config.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import {
  useAgents,
  useIsAgentInaccessible,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { AgentInaccessibleOverlay } from "../../agents/components/agent-inaccessible-overlay.js";
import { AgentUnavailableOverlay } from "../../agents/components/agent-unavailable-overlay.js";
import { ContributionFailuresBadge } from "../../agents/components/contribution-failures-badge.js";
import { useAgentReachabilityProbe } from "../../agents/hooks/use-agent-reachability-probe.js";
import { useAutoWakeOnOpen } from "../../agents/hooks/use-auto-wake-on-open.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "../../agents/hooks/use-restart-agent.js";
import { isExperimentSandbox } from "../../agents/utils/agent-kind.js";
import { resolveAgentDisplay } from "../../agents/utils/agent-resolver.js";
import { EgressApprovalToasts } from "../../approvals/components/egress-approval-toasts.js";
import { ChatArtifactsPanel } from "../../artifacts/components/chat-artifacts-panel.js";
import { DockedArtifactPanel } from "../../artifacts/components/docked-artifact-panel.js";
import { useAgentExperimentsLive } from "../../experiments/api/queries.js";
import { ExperimentDockPanel } from "../../experiments/components/experiment-dock-panel.js";
import { useDockedExperiment } from "../../experiments/hooks/use-docked-experiment.js";
import { useExperimentGreeting } from "../../experiments/hooks/use-experiment-greeting.js";
import { DockedFilePanel } from "../../files/components/docked-file-panel.js";
import { FilesPanel } from "../../files/components/files-panel.js";
import { ImportInProgressBadge } from "../../files/components/import-in-progress-badge.js";
import { useFileTree } from "../../files/hooks/use-file-tree.js";
import { useKnowledgeBaseGreeting } from "../../knowledge-bases/hooks/use-knowledge-base-greeting.js";
import { confirmDeleteKnowledgeBase } from "../../knowledge-bases/lib/confirm-delete.js";
import {
  acpSessionsKeys,
  optimisticInsertSession,
  setSessionRunning,
} from "../api/queries.js";
import { ChatColumn } from "../components/chat-column.js";
import { ChatInputArea } from "../components/chat-input-area.js";
import { ChatMessage } from "../components/chat-message.js";
import { NewSessionLauncher } from "../components/new-session-launcher.js";
import { PermissionStatusLine } from "../components/permission-prompt.js";
import { SessionsSidebar } from "../components/sessions-sidebar.js";
import { Terminal } from "../components/terminal.js";
import type { ConnectionState } from "../hooks/use-acp-connection.js";
import { useAcpSession } from "../hooks/use-acp-session.js";
import { useHasPendingPermission } from "../hooks/use-pending-permissions.js";
import { useSessionUrlSync } from "../hooks/use-session-url-sync.js";

export function ChatView() {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const { data: agentsData } = useAgents();
  const agents = agentsData?.list ?? [];
  const agentOperable = useIsAgentOperable(selectedAgent);
  // A followed link may land anyone here, not just the owner.
  const agentInaccessible = useIsAgentInaccessible(selectedAgent);

  // The open session rides in the URL, so this chat is linkable as itself.
  useSessionUrlSync(selectedAgent);

  useSyncRestartingAgents();
  useAgentReachabilityProbe(selectedAgent);
  useAutoWakeOnOpen(selectedAgent);
  const restartingAgents = useStore((s) => s.restartingAgents);
  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const agentView = agents.find((a) => a.id === selectedAgent) ?? null;
  const agentDisplay = agentView
    ? resolveAgentDisplay(agentView, restartingIds)
    : null;
  const selectedAgentName = agentView?.name ?? selectedAgent;
  const sessionId = useStore((s) => s.sessionId);
  const sessionMode = useStore((s) => s.sessionMode);
  const setSessionMode = useStore((s) => s.setSessionMode);
  const setSessionId = useStore((s) => s.setSessionId);
  const messages = useStore((s) => s.messages);
  const sessionError = useStore((s) => s.sessionError);
  const setSessionError = useStore((s) => s.setSessionError);
  const deleteSession = useStore((s) => s.deleteSession);
  const openFilePath = useStore((s) => s.openFilePath);
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const pendingLaunch = useStore((s) => s.pendingLaunch);
  const unfocusPendingLaunch = useStore((s) => s.unfocusPendingLaunch);
  const {
    experiment: dockedExperiment,
    options: experimentOptions,
    select: selectExperiment,
  } = useDockedExperiment(selectedAgent);
  // A dashboard artifact is a doorway back to its experiment: opening it from
  // the artifacts section docks the full panel (buttons and all), not a bare
  // preview. Prefer a live run over the newest terminal one.
  const agentExperiments = useAgentExperimentsLive(selectedAgent);
  const dashboardExperiment = openArtifactId
    ? (agentExperiments.find(
        (e) =>
          e.dashboardArtifactId === openArtifactId &&
          (e.status === "draft" || e.status === "running"),
      ) ??
      agentExperiments.find((e) => e.dashboardArtifactId === openArtifactId) ??
      null)
    : null;
  const artifactsSectionOpen = useStore((s) => s.artifactsSectionOpen);
  const setArtifactsSectionOpen = useStore((s) => s.setArtifactsSectionOpen);
  const goBack = useStore((s) => s.goBack);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const navigateToKnowledgeBaseConfig = useStore(
    (s) => s.navigateToKnowledgeBaseConfig,
  );
  const navigateToKnowledgeBases = useStore((s) => s.navigateToKnowledgeBases);
  const setView = useStore((s) => s.setView);
  const filesSectionOpen = useStore((s) => s.filesSectionOpen);
  const setFilesSectionOpen = useStore((s) => s.setFilesSectionOpen);
  const hasPendingPermission = useHasPendingPermission();
  const mobileScreen = useStore((s) => s.mobileScreen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const terminalPaused = useStore((s) => s.terminalPaused);
  const setTerminalPaused = useStore((s) => s.setTerminalPaused);

  const [leftW, setLeftW] = useState(
    () => Number(localStorage.getItem("platform-left-w")) || 220,
  );
  // null = no stored width yet: the file panel splits 50/50 with the chat
  // column until the user drags the divider. The key is new on purpose — the
  // old panel's stored "platform-right-w" shouldn't override the split.
  const [rightW, setRightW] = useState<number | null>(
    () => Number(localStorage.getItem("platform-file-w")) || null,
  );
  const filePanelRef = useRef<HTMLDivElement>(null);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [sessionsH, setSessionsH] = useState(
    () => Number(localStorage.getItem("platform-sessions-h")) || 260,
  );
  // Collapse/expand animates via flex transitions; suppressed while dragging
  // the divider so resizing stays immediate.
  const [resizingSections, setResizingSections] = useState(false);
  const sectionTransition = resizingSections
    ? undefined
    : "transition-[flex] duration-200";
  const sectionFlex = (open: boolean, fixedPx?: number): CSSProperties => ({
    flex: !open
      ? "0 0 44px"
      : fixedPx !== undefined
        ? `0 0 ${fixedPx}px`
        : "1 1 0%",
  });
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

  // A KB has its own route to key off; an experiment sandbox opens in this
  // ordinary chat, so its greeting keys off the Kind marker.
  const view = useStore((s) => s.view);
  const chatIdle = !sessionId && messages.length === 0;
  useKnowledgeBaseGreeting({
    agentId: selectedAgent,
    active: view === "knowledge-base-chat",
    idle: chatIdle,
    sendPrompt,
  });
  useExperimentGreeting({
    agentId: selectedAgent,
    active: agentView !== null && isExperimentSandbox(agentView),
    idle: chatIdle,
    sendPrompt,
  });

  // Pending-launch chat takeover: while a just-started run's session is
  // being opened (pod wake), blank the pane and show the launch loader.
  // Safe against the real session: openLaunchSession clears the pending
  // record BEFORE opening it, and deliberate navigation unfocuses.
  const launchPaneActive = Boolean(
    pendingLaunch?.focused && pendingLaunch.agentId === selectedAgent,
  );
  useEffect(() => {
    if (launchPaneActive && sessionId) resetSession();
  }, [launchPaneActive, sessionId, resetSession]);

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

  const pendingTerminal = useStore((s) => s.pendingTerminal);
  const setPendingTerminal = useStore((s) => s.setPendingTerminal);
  useEffect(() => {
    if (!selectedAgent || !pendingTerminal) return;
    setPendingTerminal(false);
    // Same fresh-terminal spawn as the blank chat → terminal toggle: a
    // client-side ephemeral PTY session, no server registration. Mode first:
    // the URL carries the open session, and an ephemeral PTY id is not one —
    // seeing it before the mode would put it in the address bar for a frame.
    const id = crypto.randomUUID();
    ephemeralTerminalIdRef.current = id;
    setSessionMode(SessionMode.Terminal);
    setSessionId(id);
  }, [
    selectedAgent,
    pendingTerminal,
    setPendingTerminal,
    setSessionId,
    setSessionMode,
  ]);

  const mobileResumeSession = useCallback(
    (sid: string, mode?: SessionMode) => {
      // Deliberate navigation releases the pending-launch chat takeover.
      unfocusPendingLaunch();
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
      unfocusPendingLaunch,
    ],
  );

  const handleNewSession = useCallback(() => {
    // Deliberate navigation releases the pending-launch chat takeover.
    unfocusPendingLaunch();
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
    unfocusPendingLaunch,
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
    // Mode before id — see the pending-terminal effect above.
    setSessionMode(SessionMode.Terminal);
    setSessionId(id);
    setMobileScreen("chat");
  }, [resetSession, setSessionId, setSessionMode, setMobileScreen]);

  // A knowledge base is an agent under its own surface — when the chat was
  // reached via the KB route, header actions route to the KB config page and
  // speak in KB terms, not "sandbox". Route-derived on purpose (not
  // agent.kind): leaving must return to the surface the user came from. One
  // copy object instead of per-string ternaries in the JSX below.
  const isKnowledgeBaseView = view === "knowledge-base-chat";
  const surfaceCopy = isKnowledgeBaseView
    ? {
        actionsAria: "Knowledge base actions",
        configure: "Configure knowledge base",
        delete: "Delete Knowledge Base",
        modelTitle: "Open knowledge base configuration",
        newSessionHint: "Send a message to begin a new session",
      }
    : {
        actionsAria: "Sandbox actions",
        configure: "Configure sandbox",
        delete: "Delete Sandbox",
        modelTitle: "Model — change in sandbox configuration",
        newSessionHint: "Send a message to begin or open a new session in:",
      };
  // The launcher offers terminal and editor access to a *sandbox*; the
  // knowledge-base surface keeps its own vocabulary, so its hint ends the
  // sentence instead of introducing the row.
  const showLauncher = Boolean(selectedAgent) && !isKnowledgeBaseView;

  const handleConfigureSandbox = useCallback(() => {
    if (!selectedAgent) return;
    if (isKnowledgeBaseView) navigateToKnowledgeBaseConfig(selectedAgent);
    else navigateToSandboxHome(selectedAgent);
  }, [
    selectedAgent,
    isKnowledgeBaseView,
    navigateToKnowledgeBaseConfig,
    navigateToSandboxHome,
  ]);

  const handleRestartSandbox = useCallback(() => {
    if (selectedAgent) restart(selectedAgent);
  }, [selectedAgent, restart]);

  const handleDeleteSandbox = useCallback(async () => {
    if (!selectedAgent) return;
    const ok = isKnowledgeBaseView
      ? await confirmDeleteKnowledgeBase(showConfirm, selectedAgentName ?? "")
      : await showConfirm(
          "Delete this sandbox? This also deletes all persistent data and cannot be undone.",
          "Delete Sandbox",
          { kind: "destructive" },
        );
    if (!ok) return;
    deleteAgent.mutate({ id: selectedAgent });
    if (isKnowledgeBaseView) navigateToKnowledgeBases();
    else setView("list");
  }, [
    selectedAgent,
    selectedAgentName,
    isKnowledgeBaseView,
    showConfirm,
    deleteAgent,
    navigateToKnowledgeBases,
    setView,
  ]);

  const handleBack = useCallback(() => {
    if (isMobile() && mobileScreen === "chat") {
      setMobileScreen("sessions");
      return;
    }
    resetSession();
    goBack();
  }, [mobileScreen, setMobileScreen, resetSession, goBack]);

  const dotColor = agentDisplay
    ? stateDotClass[agentDisplay.state]
    : "bg-warning";

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
        className={`${mobileScreen === "sessions" ? "hidden md:flex" : "flex"} items-center gap-3 px-6 h-[70px] border-b border-border shrink-0 relative z-content`}
      >
        <Button
          variant="ghost"
          size="inline"
          aria-label="Back"
          onClick={handleBack}
          className="md:hidden gap-1 text-sm font-medium text-muted-foreground hover:bg-transparent"
        >
          <ArrowLeft size={14} />
        </Button>
        <div className="group flex items-center gap-3 min-w-0">
          <span
            aria-hidden
            className={cn("h-2 w-2 rounded-full shrink-0", dotColor)}
          />
          <h1 className="text-sm font-bold text-foreground truncate">
            {selectedAgentName}
          </h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={surfaceCopy.actionsAria}
                className={HOVER_ACTION}
              >
                <OverflowMenuVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={handleConfigureSandbox}>
                {surfaceCopy.configure}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleRestartSandbox}>
                Restart
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={handleDeleteSandbox}
              >
                {surfaceCopy.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="ml-auto flex items-center gap-2">
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
          className={`shrink-0 flex flex-col border-r border-border overflow-hidden relative z-content ${
            mobileScreen === "chat" ? "hidden md:flex" : "flex"
          } ${mobileScreen === "sessions" ? "max-md:!w-full" : ""}`}
        >
          <SessionsSidebar
            open={sessionsOpen}
            onToggle={() => setSessionsOpen((o) => !o)}
            className={sectionTransition}
            style={sectionFlex(
              sessionsOpen,
              sessionsOpen && filesSectionOpen ? sessionsH : undefined,
            )}
            onResumeSession={mobileResumeSession}
            onNewSession={handleNewSession}
          />
          {sessionsOpen && filesSectionOpen && (
            <ResizeHandle
              orientation="vertical"
              onResize={(d) => {
                setResizingSections(true);
                setSessionsH((h) => {
                  const v = Math.max(120, Math.min(600, h + d));
                  localStorage.setItem("platform-sessions-h", String(v));
                  return v;
                });
              }}
              onDragEnd={() => setResizingSections(false)}
            />
          )}
          <FilesPanel
            open={filesSectionOpen}
            onToggle={() => setFilesSectionOpen(!filesSectionOpen)}
            className={sectionTransition}
            style={sectionFlex(filesSectionOpen)}
            onOpenFile={openFileHandler}
          />
          <ChatArtifactsPanel
            agentId={selectedAgent}
            open={artifactsSectionOpen}
            onToggle={() => setArtifactsSectionOpen(!artifactsSectionOpen)}
            className={sectionTransition}
            style={sectionFlex(artifactsSectionOpen)}
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
                  {/* min-h-full lets the new-session state centre itself in the
                      pane; with a transcript the content outgrows it anyway. */}
                  <ChatColumn className="px-4 md:px-8 py-8 flex flex-col gap-8 min-h-full">
                    {loadingSession && (
                      <div className="py-20 flex items-center justify-center gap-3 text-sm text-muted-foreground">
                        <Spinner size={20} />
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
                      messages.length === 0 &&
                      (launchPaneActive ? (
                        <div className="py-24 text-center anim-in">
                          <Spinner size={22} className="mb-3" />
                          <p className="text-base font-bold text-foreground mb-2">
                            Starting the run…
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Waking the agent and opening the launch session —
                            this can take up to a minute. The conversation
                            appears here as soon as it&apos;s up.
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-1 flex-col items-center justify-center text-center">
                          <p className="text-base font-bold text-foreground mb-2">
                            Start a new session
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {surfaceCopy.newSessionHint}
                          </p>
                          {showLauncher && selectedAgent && (
                            <NewSessionLauncher
                              agentId={selectedAgent}
                              agentName={selectedAgentName ?? ""}
                              onNewTerminal={handleNewTerminal}
                            />
                          )}
                        </div>
                      ))}
                    {messages.map((m, mi) => (
                      <ChatMessage
                        key={m.id}
                        message={m}
                        isLast={mi === messages.length - 1}
                        hasPendingPermission={hasPendingPermission}
                        onRetry={sendPrompt}
                        onFileClick={openFileHandler}
                      />
                    ))}
                    {!statusLineInThread && <PermissionStatusLine />}
                  </ChatColumn>
                </div>

                {showJump && (
                  <button
                    onClick={scrollToBottom}
                    className="absolute left-1/2 -translate-x-1/2 bottom-3 z-raised inline-flex items-center gap-1.5 h-[35px] rounded-full border border-border bg-background px-3 text-sm font-normal text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-muted transition-colors"
                  >
                    <ArrowDown size={16} />
                    Jump to latest
                  </button>
                )}
              </div>

              <div className="pb-4">
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
                      <Tooltip content={surfaceCopy.modelTitle}>
                        <button
                          type="button"
                          onClick={handleConfigureSandbox}
                          className="flex items-center gap-1 pl-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {harnessCurrent.model}
                          <Settings size={12} />
                        </button>
                      </Tooltip>
                    </ChatColumn>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Docked file / artifact / experiment panel — hidden unless one is
            open (mutually exclusive, in that priority); the experiment panel
            docks itself while the agent has a draft or live run. Fullscreen
            takeover on mobile */}
        {(openFilePath || openArtifactId || dockedExperiment) && (
          <>
            <div className="hidden md:flex">
              <ResizeHandle
                side="right"
                onResize={(d) =>
                  setRightW((w) => {
                    const base = w ?? filePanelRef.current?.offsetWidth ?? 0;
                    // Keep at least ~500px for the sidebar + chat column.
                    const max = Math.min(960, window.innerWidth - 500);
                    const v = Math.max(240, Math.min(max, base + d));
                    localStorage.setItem("platform-file-w", String(v));
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
                "flex flex-col overflow-hidden bg-background relative z-content max-md:fixed max-md:inset-0 max-md:z-overlay",
                rightW !== null
                  ? "md:shrink-0 md:w-[var(--file-w)]"
                  : "md:flex-1 md:basis-0 md:min-w-0",
                "md:border-l md:border-border",
              )}
            >
              {openFilePath ? (
                <DockedFilePanel onOpenFile={openFileHandler} />
              ) : dashboardExperiment ? (
                <ExperimentDockPanel
                  experiment={dashboardExperiment}
                  onClose={() => setOpenArtifactId(null)}
                />
              ) : openArtifactId ? (
                <DockedArtifactPanel />
              ) : dockedExperiment ? (
                <ExperimentDockPanel
                  experiment={dockedExperiment}
                  options={experimentOptions}
                  onSelect={selectExperiment}
                />
              ) : null}
            </div>
          </>
        )}
      </div>

      <EgressApprovalToasts agentId={selectedAgent} />

      {/* Access outranks lifecycle: an agent the user may not open has no
          lifecycle state to report, and its overlay would otherwise sit on
          "Loading agent…" for as long as they kept the tab open. */}
      {selectedAgent && agentInaccessible ? (
        <AgentInaccessibleOverlay onLeave={goBack} />
      ) : selectedAgent && !agentOperable ? (
        <AgentUnavailableOverlay
          agent={agentView}
          display={agentDisplay}
          name={selectedAgentName ?? ""}
          onBack={handleBack}
        />
      ) : null}
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
      {reconnecting && <Badge variant="warning">Reconnecting</Badge>}
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
    <Callout tone="danger" className="my-4 flex flex-col gap-3 anim-in">
      <div className="flex items-start gap-3">
        <Warning size={20} className="text-danger shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-bold text-foreground mb-1">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground break-words">
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
            <TrashCan size={12} /> Delete orphaned session
          </Button>
        )}
      </div>
    </Callout>
  );
}

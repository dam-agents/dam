import {
  ArrowDown,
  ArrowLeft,
  OverflowMenuVertical,
  Renew,
  TrashCan,
  Warning,
} from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { Spinner } from "@/components/ui/spinner";
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
import { usePublicAgentFallback } from "../../agents/hooks/use-public-agent-fallback.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "../../agents/hooks/use-restart-agent.js";
import { isExperimentSandbox } from "../../agents/utils/agent-kind.js";
import { resolveAgentDisplay } from "../../agents/utils/agent-resolver.js";
import { ChatArtifactsPanel } from "../../artifacts/components/chat-artifacts-panel.js";
import { DockedArtifactPanel } from "../../artifacts/components/docked-artifact-panel.js";
import { useAgentExperimentsLive } from "../../experiments/api/queries.js";
import { ExperimentDockPanel } from "../../experiments/components/experiment-dock-panel.js";
import { ExperimentPromptChips } from "../../experiments/components/experiment-prompt-chips.js";
import { useDockedExperiment } from "../../experiments/hooks/use-docked-experiment.js";
import { useExperimentGreeting } from "../../experiments/hooks/use-experiment-greeting.js";
import { DockedFilePanel } from "../../files/components/docked-file-panel.js";
import { FilesPanel } from "../../files/components/files-panel.js";
import { ImportInProgressBadge } from "../../files/components/import-in-progress-badge.js";
import { useFileTree } from "../../files/hooks/use-file-tree.js";
import { useKnowledgeBaseGreeting } from "../../knowledge-bases/hooks/use-knowledge-base-greeting.js";
import { confirmDeleteKnowledgeBase } from "../../knowledge-bases/lib/confirm-delete.js";
import { useSessionBackgroundWork } from "../api/background-work.js";
import {
  acpSessionsKeys,
  optimisticInsertSession,
  setSessionRunning,
} from "../api/queries.js";
import { BackgroundWorkIndicator } from "../components/background-work-indicator.js";
import { ChatColumn } from "../components/chat-column.js";
import { ChatInputArea } from "../components/chat-input-area.js";
import { ChatMessage } from "../components/chat-message.js";
import { ModelIndicator } from "../components/model-indicator.js";
import { NewSessionLauncher } from "../components/new-session-launcher.js";
import { PermissionStatusLine } from "../components/permission-prompt.js";
import { SessionsSidebar } from "../components/sessions-sidebar.js";
import { Terminal } from "../components/terminal.js";
import type { ConnectionState } from "../hooks/use-acp-connection.js";
import { useAcpSession } from "../hooks/use-acp-session.js";
import { useHasPendingPermission } from "../hooks/use-pending-permissions.js";
import {
  pushSessionPath,
  useSessionUrlSync,
} from "../hooks/use-session-url-sync.js";

export function ChatView() {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const { data: agentsData } = useAgents();
  const agents = agentsData?.list ?? [];
  const agentOperable = useIsAgentOperable(selectedAgent);
  const agentInaccessible = useIsAgentInaccessible(selectedAgent);
  const leavingForPublicPage = usePublicAgentFallback(
    selectedAgent,
    agentInaccessible,
  );

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
  const [rightW, setRightW] = useState<number | null>(
    () => Number(localStorage.getItem("platform-file-w")) || null,
  );
  const filePanelRef = useRef<HTMLDivElement>(null);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [sessionsH, setSessionsH] = useState(
    () => Number(localStorage.getItem("platform-sessions-h")) || 260,
  );
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
  const terminalFreshRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    resetSession,
    resumeSession,
    loadOlderMessages,
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

  const launchPaneActive = Boolean(
    pendingLaunch?.focused && pendingLaunch.agentId === selectedAgent,
  );
  useEffect(() => {
    if (launchPaneActive && sessionId) resetSession();
  }, [launchPaneActive, sessionId, resetSession]);

  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  const pendingPrependRef = useRef<{
    height: number;
    before: string;
  } | null>(null);

  const loadOlderKeepingScroll = useCallback(
    async (before: string): Promise<"paged" | "reloaded" | "noop"> => {
      const el = messagesRef.current;
      if (el) {
        pendingPrependRef.current = { height: el.scrollHeight, before };
        el.style.overflowAnchor = "none";
      }
      const outcome = await loadOlderMessages(before);
      if (outcome !== "paged") {
        pendingPrependRef.current = null;
        if (el) el.style.overflowAnchor = "";
        if (outcome === "reloaded") scrollToBottom();
      }
      return outcome;
    },
    [loadOlderMessages, scrollToBottom],
  );

  useLayoutEffect(() => {
    const pending = pendingPrependRef.current;
    const el = messagesRef.current;
    if (!pending || !el) return;
    if (messages.some((m) => m.loadOlderBefore === pending.before)) {
      pending.height = el.scrollHeight;
      return;
    }
    pendingPrependRef.current = null;
    el.scrollTop += el.scrollHeight - pending.height;
    el.style.overflowAnchor = "";
  }, [messages]);

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

  useLayoutEffect(() => {
    if (loadingSession) return;
    const el = messagesRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, [loadingSession, sessionId]);

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

  const pushSessionUrl = useCallback(
    (sid: string | null, mode: SessionMode | null) => {
      if (view !== "chat" || !selectedAgent) return;
      pushSessionPath(selectedAgent, sid, mode);
    },
    [view, selectedAgent],
  );

  const mobileResumeSession = useCallback(
    (sid: string, mode?: SessionMode) => {
      unfocusPendingLaunch();
      pushSessionUrl(sid, mode ?? SessionMode.Chat);
      setMobileScreen("chat");
      setSessionMode(mode ?? SessionMode.Chat);
      if (mode === SessionMode.Terminal) {
        setSessionId(sid);
        return;
      }
      if (sid === sessionId && !sessionError) {
        scrollToBottom();
        return;
      }
      resumeSession(sid);
    },
    [
      sessionId,
      sessionError,
      setMobileScreen,
      setSessionMode,
      setSessionId,
      resumeSession,
      scrollToBottom,
      unfocusPendingLaunch,
      pushSessionUrl,
    ],
  );

  const handleNewSession = useCallback(() => {
    unfocusPendingLaunch();
    if (!sessionId && messages.length === 0) {
      setMobileScreen("chat");
      return;
    }
    pushSessionUrl(null, null);
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
    pushSessionUrl,
  ]);

  const showConfirm = useStore((s) => s.showConfirm);

  const handleNewTerminal = useCallback(() => {
    resetSession();
    const id = crypto.randomUUID();
    terminalFreshRef.current = true;
    setSessionMode(SessionMode.Terminal);
    setSessionId(id);
    setMobileScreen("chat");
  }, [resetSession, setSessionId, setSessionMode, setMobileScreen]);

  const isKnowledgeBaseView = view === "knowledge-base-chat";
  const surfaceCopy = isKnowledgeBaseView
    ? {
        actionsAria: "Knowledge base actions",
        configure: "Configure knowledge base",
        delete: "Delete Knowledge Base",
        modelSubject: "knowledge base",
        modelSettings: null,
      }
    : {
        actionsAria: "Agent actions",
        configure: "Configure agent",
        delete: "Delete Agent",
        modelSubject: "agent",
        modelSettings: "Agent Setup",
      };

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
          "Delete this agent? This also deletes all persistent data and cannot be undone.",
          "Delete Agent",
          { kind: "destructive" },
        );
    if (!ok) return;
    deleteAgent.mutate({ id: selectedAgent });
    if (isKnowledgeBaseView) navigateToKnowledgeBases();
    else setView("home");
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

  const lastMessage = messages[messages.length - 1];
  const statusLineInThread =
    lastMessage?.role === "assistant" && !lastMessage.notice;

  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      {}
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
        <div className="flex items-center gap-3 min-w-0">
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
            sessionId={sessionId}
          />
        </div>
      </header>

      {}
      <div className="flex flex-1 min-h-0">
        {}
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

        {}
        <div
          className={`relative flex flex-1 flex-col min-w-0 ${mobileScreen === "sessions" ? "hidden md:flex" : "flex"}`}
        >
          {}
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
              onSubmit={() => setSessionRunning(selectedAgent, sessionId, true)}
            />
          ) : (
            <>
              <div className="relative flex flex-1 flex-col min-h-0">
                <div ref={messagesRef} className="flex-1 overflow-y-auto">
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
                        onRetry={() => resumeSession(sessionError.sessionId)}
                        onDelete={async () => {
                          if (!(await deleteSession(sessionError.sessionId)))
                            return;
                          setSessionError(null);
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
                            Send a message to begin or open a new session in:
                          </p>
                          {selectedAgent && (
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
                        onLoadOlder={loadOlderKeepingScroll}
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
                {agentView && isExperimentSandbox(agentView) && (
                  <div className="px-4 md:px-8">
                    <ChatColumn>
                      <ExperimentPromptChips busy={busy} onSend={sendPrompt} />
                    </ChatColumn>
                  </div>
                )}
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
                      <ModelIndicator
                        model={harnessCurrent.model}
                        subject={surfaceCopy.modelSubject}
                        settings={
                          surfaceCopy.modelSettings
                            ? {
                                label: surfaceCopy.modelSettings,
                                onConfigure: handleConfigureSandbox,
                              }
                            : undefined
                        }
                      />
                    </ChatColumn>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {}
        {(openFilePath || openArtifactId || dockedExperiment) && (
          <>
            <div className="hidden md:flex">
              <ResizeHandle
                side="right"
                onResize={(d) =>
                  setRightW((w) => {
                    const base = w ?? filePanelRef.current?.offsetWidth ?? 0;
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
                <DockedArtifactPanel key={openArtifactId} />
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

      {leavingForPublicPage ? (
        <AgentInaccessibleOverlay onLeave={goBack} />
      ) : selectedAgent && !agentInaccessible && !agentOperable ? (
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

function ChatHeaderStatus({
  selectedAgent,
  agents,
  busy,
  connectionState,
  sessionId,
}: {
  selectedAgent: string | null;
  agents: AgentView[];
  busy: boolean;
  connectionState: ConnectionState;
  sessionId: string | null;
}) {
  const agent = agents.find((a) => a.id === selectedAgent);
  const backgroundWork = useSessionBackgroundWork(selectedAgent, sessionId);
  const reconnecting =
    connectionState === "reconnecting" || connectionState === "reloading";
  return (
    <>
      <BackgroundWorkIndicator items={backgroundWork} />
      {reconnecting && <Badge variant="warning">Reconnecting</Badge>}
      <ImportInProgressBadge agentId={selectedAgent} />
      {!busy && agent && (
        <ContributionFailuresBadge failures={agent.contributionFailures} />
      )}
    </>
  );
}

const RESUME_FAILURE_COPY: Record<
  SessionError["kind"],
  { title: string; body: string }
> = {
  unavailable: {
    title: "Can't open this conversation",
    body: "It may have been deleted, or the link may point somewhere you can't open.",
  },
  orphaned: {
    title: "This conversation can't be reopened",
    body: "The agent still lists it but no longer holds its history. Deleting it clears the leftover entry from the list.",
  },
  connection: {
    title: "Can't reach the agent",
    body: "The agent didn't answer. It may be waking up or hibernating — try again in a moment.",
  },
  other: {
    title: "Can't open this conversation",
    body: "The agent still has it, but it wouldn't load.",
  },
};

function SessionErrorCard({
  error,
  onRetry,
  onDelete,
}: {
  error: SessionError;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const { title, body } = RESUME_FAILURE_COPY[error.kind];
  return (
    <Callout tone="danger" className="my-4 flex flex-col gap-3 anim-in">
      <div className="flex items-start gap-3">
        <Warning size={20} className="text-danger shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-bold text-foreground mb-1">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground break-words">{body}</p>
        </div>
      </div>
      {}
      {(error.kind === "connection" || error.kind === "orphaned") && (
        <div className="flex items-center gap-2 flex-wrap">
          {error.kind === "connection" ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <Renew size={12} /> Try again
            </Button>
          ) : (
            <Button variant="destructive" size="sm" onClick={onDelete}>
              <TrashCan size={12} /> Delete this session
            </Button>
          )}
        </div>
      )}
    </Callout>
  );
}

import {
  ArrowDown,
  Code as CodeIcon,
  Terminal as TerminalIcon,
} from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import {
  AlertCircle,
  ArrowLeft,
  FileText as FileIcon,
  Loader2,
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
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { Markdown } from "../../../components/markdown.js";
import { ResizeHandle } from "../../../components/resize-handle.js";
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
  OpenInIdeDialog,
  OpenInTerminalDialog,
} from "../../sandboxes/components/open-in-menu.js";
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
  const selectedAgentName = agentView?.name ?? selectedAgent;
  const sessionId = useStore((s) => s.sessionId);
  const sessionMode = useStore((s) => s.sessionMode);
  const setSessionMode = useStore((s) => s.setSessionMode);
  const setSessionId = useStore((s) => s.setSessionId);
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);

  // Seed rich mock messages so formatting options are visible immediately
  useEffect(() => {
    if (!import.meta.env.VITE_MOCK) return;
    if (!selectedAgent || messages.length > 0) return;
    setMessages([
      {
        id: "mock-user-1",
        role: "user",
        streaming: false,
        parts: [
          {
            kind: "text",
            text: "How do I change the model for this sandbox?",
          },
        ],
      },
      {
        id: "mock-assistant-1",
        role: "assistant",
        streaming: false,
        parts: [
          {
            kind: "text",
            text: `Open the configure panel and update the \`model\` field under **Runtime Settings**. You can set it to any value from \`harnessConfig.status.catalog.options\`, like \`claude-sonnet-4-20250514\` or \`claude-opus-4-20250514\`.

After saving, poll \`harnessConfig.settled\` until it returns \`{ settled: true }\`. If the sandbox is \`running\`, the change applies immediately — no restart needed.`,
          },
        ],
      },
    ]);
  }, [selectedAgent, messages.length, setMessages]);

  const sessionError = useStore((s) => s.sessionError);
  const setSessionError = useStore((s) => s.setSessionError);
  const deleteSession = useStore((s) => s.deleteSession);
  const openAgentTerminal = useStore((s) => s.openAgentTerminal);
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

  // Feature-discovery tooltip for connections
  const [connectionsTipDismissed, setConnectionsTipDismissed] = useState(false);
  const isKbChat = view === "knowledge-base-chat";
  const isExperimentChat = agentView !== null && isExperimentSandbox(agentView);
  const showConnectionsTip =
    !connectionsTipDismissed &&
    (isKbChat || isExperimentChat) &&
    messages.length > 0 &&
    !busy;
  const discoveryTooltip = showConnectionsTip
    ? {
        title: "Add connections",
        message: isKbChat
          ? "Give your knowledge base access to GitHub repos, Slack archives, and APIs so it can pull source material automatically."
          : "Give your experiment access to APIs, code repos, and compute platforms like GitHub and Modal.",
        actionLabel: "Configure connections",
        onAction: () => {
          if (!selectedAgent) return;
          if (isKbChat) navigateToKnowledgeBaseConfig(selectedAgent);
          else navigateToSandboxHome(selectedAgent);
        },
        open: true,
        onDismiss: () => setConnectionsTipDismissed(true),
      }
    : undefined;

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
  const [openInDialog, setOpenInDialog] = useState<"terminal" | "ide" | null>(
    null,
  );

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
    // client-side ephemeral PTY session, no server registration.
    const id = crypto.randomUUID();
    ephemeralTerminalIdRef.current = id;
    setSessionId(id);
    setSessionMode(SessionMode.Terminal);
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
    setSessionId(id);
    setSessionMode(SessionMode.Terminal);
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
      }
    : {
        actionsAria: "Sandbox actions",
        configure: "Configure sandbox",
        delete: "Delete Sandbox",
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
        className={`${mobileScreen === "sessions" ? "hidden md:flex" : "flex"} items-center gap-3 px-6 h-[70px] border-b border-border-light shrink-0 relative z-content`}
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
                aria-label={surfaceCopy.actionsAria}
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreVertical size={14} />
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
          className={`shrink-0 flex flex-col border-r border-border-light overflow-hidden relative z-content ${
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
            onNewTerminal={handleNewTerminal}
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
                  <ChatColumn className="px-4 md:px-8 py-8 flex flex-col gap-8">
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
                      messages.length === 0 &&
                      (launchPaneActive ? (
                        <div className="py-24 text-center anim-in">
                          <Loader2
                            size={22}
                            className="mx-auto mb-3 animate-spin text-text-muted"
                          />
                          <p className="text-[16px] font-bold text-text mb-2">
                            Starting the run…
                          </p>
                          <p className="text-[14px] text-text-muted">
                            Waking the agent and opening the launch session —
                            this can take up to a minute. The conversation
                            appears here as soon as it&apos;s up.
                          </p>
                        </div>
                      ) : (
                        <div className="py-24 text-center">
                          <p className="text-[16px] font-bold text-text mb-2">
                            Start a conversation
                          </p>
                          <p className="text-[14px] text-text-muted">
                            Send a message to begin a new session with this
                            agent
                          </p>
                          {selectedAgent && (
                            <div className="mt-5 flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => openAgentTerminal(selectedAgent)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[14px] font-medium text-foreground hover:bg-muted/40"
                              >
                                <TerminalIcon size={16} />
                                Terminal (browser)
                              </button>
                              <button
                                type="button"
                                onClick={() => setOpenInDialog("terminal")}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[14px] font-medium text-foreground hover:bg-muted/40"
                              >
                                <TerminalIcon size={16} />
                                Terminal (local)
                              </button>
                              <button
                                type="button"
                                onClick={() => setOpenInDialog("ide")}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[14px] font-medium text-foreground hover:bg-muted/40"
                              >
                                <CodeIcon size={16} />
                                VS Code / Zed (local)
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
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
                    className="absolute left-1/2 -translate-x-1/2 bottom-3 z-raised inline-flex items-center gap-1.5 h-[35px] rounded-full border border-border-light bg-background px-3 text-[14px] font-normal text-text shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-muted transition-colors"
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
                  discoveryTooltip={discoveryTooltip}
                />
                {!hasPendingPermission && harnessCurrent?.model && (
                  <div className="px-4 md:px-8">
                    <ChatColumn>
                      <Tooltip
                        side="top"
                        className="w-[280px] rounded-xl border border-border bg-popover p-4 shadow-xl"
                        content={
                          <div className="flex items-start gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                              <CodeIcon size={16} className="text-accent" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[14px] font-semibold text-foreground">
                                Default model
                              </p>
                              <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
                                This model is used for all new messages in this
                                sandbox.
                              </p>
                              <button
                                type="button"
                                onClick={handleConfigureSandbox}
                                className="mt-2.5 inline-flex items-center gap-1 text-[14px] font-medium text-accent transition-colors hover:text-accent/80"
                              >
                                Configure default model
                                <span aria-hidden>&rarr;</span>
                              </button>
                            </div>
                          </div>
                        }
                      >
                        <button
                          type="button"
                          onClick={handleConfigureSandbox}
                          className="flex items-center gap-1 pl-3 text-[14px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {harnessCurrent.model}
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
                "md:border-l md:border-border-light",
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

      {openInDialog === "terminal" && agentView && (
        <OpenInTerminalDialog
          agent={agentView}
          onClose={() => setOpenInDialog(null)}
        />
      )}
      {openInDialog === "ide" && agentView && (
        <OpenInIdeDialog
          agent={agentView}
          onClose={() => setOpenInDialog(null)}
        />
      )}

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
    </Callout>
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
    <Callout
      tone="danger"
      className="flex max-w-[620px] items-start gap-2.5"
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
    </Callout>
  );
}

import {
  ArrowDown,
  ArrowLeft,
  OverflowMenuVertical,
  Renew,
  TrashCan,
  Warning,
} from "@carbon/icons-react";
import { SessionMode, TELEMETRY_MAX_SINCE_HOURS } from "api-server-api";
import {
  type CSSProperties,
  Fragment,
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
import { useNow } from "../../../hooks/use-now.js";
import { isMobile } from "../../../lib/breakpoints.js";
import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  useHarnessConfigCurrent,
  useHarnessConfigStatus,
} from "../../agents/api/harness-config.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import {
  useAgents,
  useIsAgentInaccessible,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { AgentInaccessibleOverlay } from "../../agents/components/agent-inaccessible-overlay.js";
import { AgentUnavailableOverlay } from "../../agents/components/agent-unavailable-overlay.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../agents/components/avatar/agent-avatar.js";
import {
  agentFailures,
  ContributionFailuresBadge,
} from "../../agents/components/contribution-failures-badge.js";
import { ContributionGapNotice } from "../../agents/components/contribution-gap-notice.js";
import { GatewayFailureBadge } from "../../agents/components/gateway-failure-badge.js";
import { RuntimeOutdatedNotice } from "../../agents/components/runtime-outdated-notice.js";
import { UnsupportedContributionsBadge } from "../../agents/components/unsupported-contributions-badge.js";
import { VmRuntimeBadge } from "../../agents/components/vm-runtime-badge.js";
import { WorkspaceFailureNotice } from "../../agents/components/workspace-failure-notice.js";
import { useAgentReachability } from "../../agents/hooks/use-agent-reachability.js";
import { useAutoWakeOnOpen } from "../../agents/hooks/use-auto-wake-on-open.js";
import { usePublicAgentFallback } from "../../agents/hooks/use-public-agent-fallback.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "../../agents/hooks/use-restart-agent.js";
import { useSlowStartIds } from "../../agents/hooks/use-slow-start.js";
import { sharesKnowledgeBase } from "../../agents/utils/agent-kind.js";
import { resolveAgentDisplay } from "../../agents/utils/agent-resolver.js";
import { ChatArtifactsPanel } from "../../artifacts/components/chat-artifacts-panel.js";
import { DockedArtifactPanel } from "../../artifacts/components/docked-artifact-panel.js";
import { DockedBrowserPanel } from "../../browser/components/docked-browser-panel.js";
import { useOpenBrowser } from "../../browser/hooks/use-auto-open-browser.js";
import { useFeatures } from "../../features/api/queries.js";
import { DockedFilePanel } from "../../files/components/docked-file-panel.js";
import { FilesPanel } from "../../files/components/files-panel.js";
import { ImportInProgressBadge } from "../../files/components/import-in-progress-badge.js";
import { useFileTree } from "../../files/hooks/use-file-tree.js";
import {
  DelegationOwnersProvider,
  useDelegationOwners,
} from "../../invocations/components/delegation-owners.js";
import { DockedDelegationPanel } from "../../invocations/components/docked-delegation-panel.js";
import { LiveDelegationBlock } from "../../invocations/components/live-delegation-block.js";
import { DockedProcessOutputPanel } from "../../processes/components/docked-process-output-panel.js";
import { ProcessesIndicator } from "../../processes/components/processes-indicator.js";
import { ProcessesPanel } from "../../processes/components/processes-panel.js";
import { useProcessesEnabled } from "../../processes/hooks/use-processes-enabled.js";
import { useProcessesLiveUpdates } from "../../processes/hooks/use-processes-live-updates.js";
import { KitUpdateBar } from "../../starter-kits/components/kit-update-bar.js";
import { OnboardingBar } from "../../starter-kits/components/onboarding-bar.js";
import { useTurns } from "../../telemetry/api/queries.js";
import { TurnTelemetry } from "../../telemetry/components/turn-telemetry.js";
import { matchTurnsToReplies } from "../../telemetry/lib/align-turns.js";
import { useSessionBackgroundWork } from "../api/background-work.js";
import { acpSessionsKeys } from "../api/keys.js";
import {
  optimisticInsertSession,
  setSessionRunning,
  useAgentSession,
} from "../api/queries.js";
import { useProviderModels } from "../api/session-pair.js";
import { BackgroundWorkIndicator } from "../components/background-work-indicator.js";
import { ChatColumn } from "../components/chat-column.js";
import { ChatInputArea } from "../components/chat-input-area.js";
import { ChatMessage } from "../components/chat-message.js";
import { ModelIndicator } from "../components/model-indicator.js";
import { NewSessionLauncher } from "../components/new-session-launcher.js";
import { OtherProviderModels } from "../components/other-provider-models.js";
import { PermissionStatusLine } from "../components/permission-prompt.js";
import { SessionLeaseNote } from "../components/session-lease-note.js";
import { SessionPairPicker } from "../components/session-pair-picker.js";
import { SessionsSidebar } from "../components/sessions-sidebar.js";
import { Terminal } from "../components/terminal.js";
import type { ConnectionState } from "../hooks/use-acp-connection.js";
import { useAcpSession } from "../hooks/use-acp-session.js";
import { useChatArtifactPrompt } from "../hooks/use-chat-artifact-prompt.js";
import { useDeleteUndelivered } from "../hooks/use-delete-undelivered.js";
import { useOpenInitializationSession } from "../hooks/use-open-initialization-session.js";
import { useHasPendingPermission } from "../hooks/use-pending-permissions.js";
import {
  pushSessionPath,
  useSessionUrlSync,
} from "../hooks/use-session-url-sync.js";
import { useSessionWatch } from "../hooks/use-session-watch.js";
import {
  type SidebarPanelStack,
  useSidebarPanels,
} from "../hooks/use-sidebar-panels.js";
import { draftKey } from "../lib/draft-key.js";
import type { SidebarPanelId } from "../lib/sidebar-panels.js";
import { dividerLabel, threadItems, timeProps } from "../lib/thread-items.js";
import { clearUndelivered } from "../lib/undelivered-store.js";
import type { SessionError } from "../store/sessions.js";

const LEFT_WIDTH_KEY = "platform-left-w";
const LEFT_MIN_W = 240;
const LEFT_MAX_W = 400;
const FILE_PANEL_WIDTH_KEY = "platform-file-w";
const CHAT_MIN_W = 320;
const SIDE_PANEL_MIN_W = 320;
const TELEMETRY_SETTLE_MS = 5 * 60_000;

function clampLeftWidth(width: number): number {
  return Math.max(LEFT_MIN_W, Math.min(LEFT_MAX_W, width));
}

function PanelDivider({
  stack,
  below,
}: {
  stack: SidebarPanelStack;
  below: SidebarPanelId;
}) {
  const divider = stack.dividerProps(below);
  return divider && <ResizeHandle orientation="vertical" {...divider} />;
}

// UNIT_BOUNDARY_DESCRIPTION: a sent message lands in the transcript a render or two after the send, so the jump to the end repeats once it is laid out and once more after this wait.
const SEND_SETTLE_MS = 300;

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
  const slowStartIds = useSlowStartIds();
  useAgentReachability(selectedAgent);
  useSessionWatch(selectedAgent);
  useAutoWakeOnOpen(selectedAgent);
  const restartingAgents = useStore((s) => s.restartingAgents);
  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const agentView = agents.find((a) => a.id === selectedAgent) ?? null;
  const runtimeOutdated = agentView?.features.liveUpdates === false;
  const agentDisplay = agentView
    ? resolveAgentDisplay(agentView, restartingIds, undefined, slowStartIds)
    : null;
  const selectedAgentName = agentView?.name ?? selectedAgent;
  const sessionId = useStore((s) => s.sessionId);
  const sessionMode = useStore((s) => s.sessionMode);
  const setSessionMode = useStore((s) => s.setSessionMode);
  const setSessionId = useStore((s) => s.setSessionId);
  const messages = useStore((s) => s.messages);
  const now = useNow(60_000);
  const runStarts = useStore((s) => s.runStarts);
  const items = useMemo(
    () => threadItems(messages, runStarts),
    [messages, runStarts],
  );
  const deleteMessage = useDeleteUndelivered(selectedAgent, sessionId);
  const sessionError = useStore((s) => s.sessionError);
  const setSessionError = useStore((s) => s.setSessionError);
  const deleteSession = useStore((s) => s.deleteSession);
  const openFilePath = useStore((s) => s.openFilePath);
  const openArtifactId = useStore((s) => s.openArtifactId);
  const openBrowserAgentId = useStore((s) =>
    s.openBrowserAgentId === s.selectedAgent ? s.openBrowserAgentId : null,
  );
  const openBrowser = useOpenBrowser();
  const browserMaximized = useStore((s) => s.browserMaximized);
  const openDelegation = useStore((s) =>
    s.openDelegation?.driverAgentId === s.selectedAgent
      ? s.openDelegation
      : null,
  );
  const artifactsSectionOpen = useStore((s) => s.artifactsSectionOpen);
  const setArtifactsSectionOpen = useStore((s) => s.setArtifactsSectionOpen);
  const processesEnabled = useProcessesEnabled();
  const processesSectionOpen = useStore((s) => s.processesSectionOpen);
  const setProcessesSectionOpen = useStore((s) => s.setProcessesSectionOpen);
  const storedProcessOutputKey = useStore((s) => s.openProcessOutputKey);
  const openProcessOutputKey = processesEnabled ? storedProcessOutputKey : null;
  useProcessesLiveUpdates(selectedAgent, processesEnabled);
  const goBack = useStore((s) => s.goBack);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setView = useStore((s) => s.setView);
  const sessionsSectionOpen = useStore((s) => s.sessionsSectionOpen);
  const setSessionsSectionOpen = useStore((s) => s.setSessionsSectionOpen);
  const filesSectionOpen = useStore((s) => s.filesSectionOpen);
  const setFilesSectionOpen = useStore((s) => s.setFilesSectionOpen);
  const hasPendingPermission = useHasPendingPermission();
  const mobileScreen = useStore((s) => s.mobileScreen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const terminalPaused = useStore((s) => s.terminalPaused);
  const setTerminalPaused = useStore((s) => s.setTerminalPaused);

  const [leftW, setLeftW] = useState(() =>
    clampLeftWidth(readPersistedNumber(LEFT_WIDTH_KEY, LEFT_MIN_W)),
  );
  const leftWRef = useRef(leftW);
  const [rightW, setRightW] = useState<number | null>(() =>
    readPersistedNumber(FILE_PANEL_WIDTH_KEY, null),
  );
  const rightWRef = useRef(rightW);
  const [columnsEl, setColumnsEl] = useState<HTMLDivElement | null>(null);
  const [columnsW, setColumnsW] = useState<number | null>(null);
  useEffect(() => {
    if (!columnsEl) return;
    const ro = new ResizeObserver(([entry]) =>
      setColumnsW(entry.contentRect.width),
    );
    ro.observe(columnsEl);
    return () => ro.disconnect();
  }, [columnsEl]);
  const filePanelRef = useRef<HTMLDivElement>(null);
  const panelStack = useSidebarPanels([
    { id: "sessions", open: sessionsSectionOpen },
    { id: "files", open: filesSectionOpen },
    { id: "artifacts", open: artifactsSectionOpen },
    ...(processesEnabled
      ? [{ id: "processes" as const, open: processesSectionOpen }]
      : []),
  ]);
  const terminalFreshRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    resetSession,
    resumeSession,
    loadOlderMessages,
    sendPrompt,
    stopAgent,
    chooseSessionModel,
    busy,
    loadingSession,
    connectionState,
  } = useAcpSession(selectedAgent, textareaRef);

  const sendArtifactPrompt = useChatArtifactPrompt({
    agentId: selectedAgent,
    sessionId,
    sessionMode,
    agentOperable,
    loadingSession,
    sendPrompt,
  });

  const { openFileHandler } = useFileTree(selectedAgent);
  const { restart } = useRestartAgent();
  const deleteAgent = useDeleteAgent();
  const { data: harnessCurrent } = useHarnessConfigCurrent(selectedAgent);
  const { data: harnessStatus } = useHarnessConfigStatus(selectedAgent);
  const { data: currentSession } = useAgentSession(selectedAgent, sessionId);
  const pickable =
    !sessionId && selectedAgent && harnessStatus?.harnesses?.length
      ? {
          agentId: selectedAgent,
          carried: harnessStatus.harnesses,
          defaultHarness:
            harnessStatus.defaultHarness ?? harnessStatus.harnesses[0]!.name,
        }
      : null;
  const { data: sessionProviderModels } = useProviderModels(
    sessionId ? selectedAgent : null,
    currentSession?.harness ?? null,
    currentSession?.provider ?? null,
  );
  const sessionModelChoices = [
    ...new Map(
      (sessionProviderModels?.availableModels ?? []).map((m) => [m.value, m]),
    ).values(),
  ];
  const sessionModel = currentSession?.harness
    ? {
        current: currentSession.model ?? "",
        choices: sessionModelChoices,
      }
    : null;
  const indicatorModel = currentSession?.harness
    ? currentSession.model
      ? (sessionModelChoices.find((c) => c.value === currentSession.model)
          ?.name ?? currentSession.model)
      : "Default model"
    : harnessCurrent?.model;

  const view = useStore((s) => s.view);
  const chatIdle = !sessionId && messages.length === 0;

  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const features = useFeatures().data;
  const telemetryEnabled = features?.["agent-telemetry"] ?? false;
  const delegationOwners = useDelegationOwners(messages);
  const telemetryLive = useMemo(() => {
    if (messages.some((m) => m.role === "assistant" && m.streaming))
      return true;
    let lastReplyAt = 0;
    for (const m of messages) {
      if (m.role === "assistant" && !m.notice && m.at !== undefined) {
        lastReplyAt = Math.max(lastReplyAt, Date.parse(m.at) || 0);
      }
    }
    return lastReplyAt > 0 && now.getTime() - lastReplyAt < TELEMETRY_SETTLE_MS;
  }, [messages, now]);
  const sessionTurns = useTurns(
    telemetryEnabled ? selectedAgent : null,
    telemetryEnabled ? sessionId : null,
    TELEMETRY_MAX_SINCE_HOURS,
    telemetryLive,
  );
  const turnsUnavailable =
    telemetryEnabled && sessionTurns.data?.available === false
      ? sessionTurns.data.reason
      : null;
  const turnsTruncated =
    sessionTurns.data?.available === true && sessionTurns.data.truncated;
  const turnForMessage = useMemo(() => {
    const rows =
      sessionTurns.data?.available === true ? sessionTurns.data.turns : [];
    return matchTurnsToReplies(rows, messages);
  }, [sessionTurns.data, messages]);

  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  const sendAndFollow = useCallback(
    (...args: Parameters<typeof sendPrompt>) => {
      scrollToBottom();
      const sent = sendPrompt(...args);
      requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
      setTimeout(scrollToBottom, SEND_SETTLE_MS);
      return sent;
    },
    [scrollToBottom, sendPrompt],
  );

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

    const FOLLOW_WITHIN_PX = 60;
    const JUMP_BEYOND_PX = 200;
    const fromBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight;

    const onScroll = () => {
      const distance = fromBottom();
      stickRef.current = distance < FOLLOW_WITHIN_PX;
      setShowJump(distance > JUMP_BEYOND_PX);
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
  const pendingResumeSessionMode = useStore((s) => s.pendingResumeSessionMode);
  useEffect(() => {
    if (!selectedAgent || !pendingResumeSessionId) return;
    const sid = pendingResumeSessionId;
    const mode = pendingResumeSessionMode;
    setPendingResumeSessionId(null);
    if (mode === SessionMode.Terminal) {
      setSessionMode(mode);
      setSessionId(sid);
      return;
    }
    resumeSession(sid);
  }, [
    selectedAgent,
    pendingResumeSessionId,
    pendingResumeSessionMode,
    setPendingResumeSessionId,
    setSessionMode,
    setSessionId,
    resumeSession,
  ]);

  useOpenInitializationSession({
    agentId: selectedAgent,
    active: view === "chat" && agentView !== null,
    idle: chatIdle,
    resumeSession,
  });
  const pushSessionUrl = useCallback(
    (sid: string | null, mode: SessionMode | null) => {
      if (view !== "chat" || !selectedAgent) return;
      pushSessionPath(selectedAgent, sid, mode);
    },
    [view, selectedAgent],
  );

  const mobileResumeSession = useCallback(
    (sid: string, mode?: SessionMode) => {
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
      pushSessionUrl,
    ],
  );

  const handleNewSession = useCallback(() => {
    const focusComposer = () =>
      requestAnimationFrame(() => textareaRef.current?.focus());
    if (selectedAgent) clearUndelivered(draftKey(selectedAgent, null));
    if (!sessionId && messages.length === 0) {
      setMobileScreen("chat");
      focusComposer();
      return;
    }
    pushSessionUrl(null, null);
    setSessionMode(SessionMode.Chat);
    resetSession();
    setMobileScreen("chat");
    focusComposer();
  }, [
    selectedAgent,
    sessionId,
    messages.length,
    resetSession,
    setMobileScreen,
    setSessionMode,
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

  const canShareKnowledge =
    agentView !== null && sharesKnowledgeBase(agentView);
  const canOpenBrowser =
    features?.["strict-connection-addressing"] === true &&
    agentView?.requireConnectionAddress === true;
  const browserFills =
    browserMaximized && openBrowserAgentId !== null && canOpenBrowser;
  const sidePanelOpen =
    openDelegation !== null ||
    openFilePath !== null ||
    openArtifactId !== null ||
    openProcessOutputKey !== null ||
    (openBrowserAgentId !== null && canOpenBrowser);
  const columnsDoNotFit =
    columnsW !== null && columnsW < leftW + CHAT_MIN_W + SIDE_PANEL_MIN_W;
  const sidePanelFills = browserFills || (sidePanelOpen && columnsDoNotFit);
  const sidePanelMaxW =
    columnsW === null ? null : columnsW - leftW - CHAT_MIN_W;
  const sidePanelW =
    rightW !== null && sidePanelMaxW !== null
      ? Math.min(rightW, Math.max(SIDE_PANEL_MIN_W, sidePanelMaxW))
      : rightW;
  const surfaceCopy = {
    actionsAria: "Agent actions",
    configure: "Configure agent",
    delete: "Delete agent",
    modelSubject: "agent",
    modelSettings: "Agent Setup",
  };

  const handleConfigureSandbox = useCallback(() => {
    if (!selectedAgent) return;
    navigateToSandboxHome(selectedAgent);
  }, [selectedAgent, navigateToSandboxHome]);

  const handleShareKnowledgeBase = () => {
    if (!selectedAgent) return;
    navigateToSandboxHome(selectedAgent, "setup", "knowledge");
  };

  const handleRestartSandbox = () => {
    if (selectedAgent) restart(selectedAgent);
  };

  const handleDeleteSandbox = async () => {
    if (!selectedAgent) return;
    const ok = await showConfirm(
      "Delete this agent? This also deletes all persistent data and cannot be undone.",
      "Delete agent",
      { kind: "destructive" },
    );
    if (!ok) return;
    deleteAgent.mutate({ id: selectedAgent });
    setView("home");
  };

  const handleBack = useCallback(() => {
    if (isMobile() && mobileScreen === "chat") {
      setMobileScreen("sessions");
      return;
    }
    resetSession();
    goBack();
  }, [mobileScreen, setMobileScreen, resetSession, goBack]);

  const leftPanelWidth = { width: leftW };

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
        className={`${mobileScreen === "sessions" ? "hidden md:flex" : "flex"} items-stretch h-[70px] max-md:border-b border-border shrink-0 relative z-content`}
      >
        <div
          style={leftPanelWidth}
          className="@container flex min-w-0 shrink-0 items-center gap-3 overflow-hidden px-6 md:px-4 max-md:!w-auto max-md:flex-1 md:border-r md:border-b md:border-border"
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
            {agentView ? (
              <>
                <AgentAvatar
                  name={agentView.name}
                  avatar={agentView.avatar}
                  size={32}
                  mood={avatarMood(
                    agentDisplay?.state,
                    agentView.stopRequested,
                    busy,
                  )}
                  className="@max-[149px]:hidden"
                />
                <span
                  aria-hidden
                  className={cn(
                    "hidden h-2 w-2 shrink-0 rounded-full @max-[149px]:block",
                    dotColor,
                  )}
                />
              </>
            ) : (
              <span
                aria-hidden
                className={cn("h-2 w-2 rounded-full shrink-0", dotColor)}
              />
            )}
            <h1 className="text-sm font-bold text-foreground truncate">
              {selectedAgentName}
            </h1>
            {agentView && (
              <span className="flex shrink-0 @max-[119px]:hidden">
                <VmRuntimeBadge
                  agent={agentView}
                  labelClassName="@max-[279px]:sr-only"
                />
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={surfaceCopy.actionsAria}
                  className="shrink-0"
                >
                  <OverflowMenuVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={handleConfigureSandbox}>
                  {surfaceCopy.configure}
                </DropdownMenuItem>
                {canShareKnowledge && (
                  <DropdownMenuItem onSelect={handleShareKnowledgeBase}>
                    Share knowledge base
                  </DropdownMenuItem>
                )}
                {canOpenBrowser && selectedAgent && (
                  <DropdownMenuItem
                    onSelect={() => void openBrowser(selectedAgent)}
                  >
                    Open browser
                  </DropdownMenuItem>
                )}
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
        </div>
        <div className="ml-auto flex items-center gap-2 pl-6 pr-14 md:pr-16">
          <ChatHeaderStatus
            selectedAgent={selectedAgent}
            agents={agents}
            busy={busy}
            connectionState={connectionState}
            sessionId={sessionId}
            processesEnabled={processesEnabled}
          />
        </div>
      </header>

      {}
      <div ref={setColumnsEl} className="flex flex-1 min-h-0">
        {}
        <div
          style={leftPanelWidth}
          className={`shrink-0 flex flex-col border-r border-border overflow-hidden relative z-content ${
            mobileScreen === "chat" ? "hidden md:flex" : "flex"
          } ${mobileScreen === "sessions" ? "max-md:!w-full" : ""} ${
            browserFills ? "md:!hidden" : ""
          }`}
        >
          {runtimeOutdated && <RuntimeOutdatedNotice agentId={selectedAgent} />}
          <ContributionGapNotice agentId={selectedAgent} />
          <WorkspaceFailureNotice agentId={selectedAgent} />
          <SessionsSidebar
            open={sessionsSectionOpen}
            onToggle={() => setSessionsSectionOpen(!sessionsSectionOpen)}
            {...panelStack.panelProps("sessions")}
            onResumeSession={mobileResumeSession}
            onNewSession={handleNewSession}
          />
          <PanelDivider stack={panelStack} below="files" />
          <FilesPanel
            open={filesSectionOpen}
            onToggle={() => setFilesSectionOpen(!filesSectionOpen)}
            {...panelStack.panelProps("files")}
            onOpenFile={openFileHandler}
          />
          <PanelDivider stack={panelStack} below="artifacts" />
          <ChatArtifactsPanel
            agentId={selectedAgent}
            open={artifactsSectionOpen}
            onToggle={() => setArtifactsSectionOpen(!artifactsSectionOpen)}
            {...panelStack.panelProps("artifacts")}
          />
          {processesEnabled && (
            <>
              <PanelDivider stack={panelStack} below="processes" />
              <ProcessesPanel
                agentId={selectedAgent}
                alwaysOn={agentView?.hibernationTimeoutMin === 0}
                open={processesSectionOpen}
                onToggle={() => setProcessesSectionOpen(!processesSectionOpen)}
                {...panelStack.panelProps("processes")}
              />
            </>
          )}
        </div>
        {!browserFills && (
          <ResizeHandle
            side="left"
            onResize={(d) => {
              const v = clampLeftWidth(leftWRef.current + d);
              leftWRef.current = v;
              writePersistedNumber(LEFT_WIDTH_KEY, v);
              setLeftW(v);
            }}
          />
        )}

        {}
        <div
          className={`@container/chat relative flex flex-1 flex-col min-w-0 ${mobileScreen === "sessions" ? "hidden md:flex" : "flex"} ${sidePanelFills ? "md:!hidden" : ""}`}
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
                  queryKey: acpSessionsKeys.agent(selectedAgent),
                });
              }}
              onSubmit={() => setSessionRunning(selectedAgent, sessionId, true)}
              onSessionMoved={setSessionId}
            />
          ) : (
            <>
              <div className="@container relative flex flex-1 flex-col min-h-0">
                <div ref={messagesRef} className="flex-1 overflow-y-auto">
                  <ChatColumn className="px-2 @xs/chat:px-4 @xl/chat:px-8 py-8 flex flex-col gap-8 min-h-full">
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
                      messages.length === 0 && (
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
                      )}
                    <DelegationOwnersProvider value={delegationOwners}>
                      {items.map((item) => {
                        if (item.kind === "divider") {
                          return (
                            <div
                              key={item.key}
                              className="flex items-center gap-3 py-2"
                            >
                              <span className="h-px flex-1 bg-border/60" />
                              <span className="text-[11px] text-muted-foreground">
                                {dividerLabel(item, now)}
                              </span>
                              <span className="h-px flex-1 bg-border/60" />
                            </div>
                          );
                        }
                        const turn = turnForMessage.get(item.message.id);
                        return (
                          <Fragment key={item.message.id}>
                            <ChatMessage
                              message={item.message}
                              avatarAgent={agentView ?? undefined}
                              isLast={item.index === messages.length - 1}
                              showModel={runStarts.length > 0}
                              {...timeProps(item.message.at, now)}
                              hasPendingPermission={hasPendingPermission}
                              onRetry={sendPrompt}
                              onFileClick={openFileHandler}
                              onDelete={deleteMessage}
                              onLoadOlder={loadOlderKeepingScroll}
                            />
                            {selectedAgent && sessionId && turn && (
                              <TurnTelemetry
                                agentId={selectedAgent}
                                sessionId={sessionId}
                                turn={turn}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                    </DelegationOwnersProvider>
                    {selectedAgent && (
                      <LiveDelegationBlock
                        driverAgentId={selectedAgent}
                        busy={busy}
                        claimed={delegationOwners}
                      />
                    )}
                    {telemetryEnabled && sessionTurns.isError && (
                      <p className="py-1 text-[11px] text-muted-foreground/70">
                        Telemetry for this session could not be read.
                      </p>
                    )}
                    {turnsUnavailable && (
                      <p className="py-1 text-[11px] text-muted-foreground/70">
                        {turnsUnavailable}
                      </p>
                    )}
                    {turnsTruncated && (
                      <p className="py-1 text-[11px] text-muted-foreground/70">
                        Older turns in this session are past the telemetry
                        display cap and are not shown.
                      </p>
                    )}
                    {!statusLineInThread && <PermissionStatusLine />}
                  </ChatColumn>
                </div>

                {showJump && (
                  <button
                    onClick={scrollToBottom}
                    className="absolute left-1/2 -translate-x-1/2 bottom-3 z-raised hidden @[11rem]:inline-flex items-center whitespace-nowrap gap-1.5 h-[35px] rounded-full border border-border bg-background px-3 text-sm font-normal text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-muted transition-colors"
                  >
                    <ArrowDown size={16} />
                    Jump to latest
                  </button>
                )}
              </div>

              <div className="pb-4">
                <OnboardingBar
                  key={selectedAgent ?? "none"}
                  agentId={selectedAgent}
                />
                <KitUpdateBar agentId={selectedAgent} />
                <ChatInputArea
                  textareaRef={textareaRef}
                  busy={busy}
                  loadingSession={loadingSession}
                  onSend={sendAndFollow}
                  onStop={stopAgent}
                />
                {!hasPendingPermission && pickable && (
                  <div className="px-2 @xs/chat:px-4 @xl/chat:px-8">
                    <ChatColumn>
                      <SessionPairPicker {...pickable} />
                    </ChatColumn>
                  </div>
                )}
                {!hasPendingPermission &&
                  !pickable &&
                  (indicatorModel || currentSession?.harness) && (
                    <div className="px-2 @xs/chat:px-4 @xl/chat:px-8">
                      <ChatColumn>
                        <div className="flex flex-wrap items-center gap-2">
                          {indicatorModel && (
                            <ModelIndicator
                              model={indicatorModel}
                              sessionChoices={
                                sessionModel
                                  ? {
                                      current: sessionModel.current,
                                      choices: sessionModel.choices,
                                      onChoose: (value) =>
                                        void chooseSessionModel(value),
                                    }
                                  : undefined
                              }
                              subject={surfaceCopy.modelSubject}
                              extra={
                                selectedAgent && currentSession?.harness ? (
                                  <OtherProviderModels
                                    agentId={selectedAgent}
                                    harness={currentSession.harness}
                                    provider={currentSession.provider ?? null}
                                  />
                                ) : undefined
                              }
                              settings={
                                surfaceCopy.modelSettings
                                  ? {
                                      label: surfaceCopy.modelSettings,
                                      onConfigure: handleConfigureSandbox,
                                    }
                                  : undefined
                              }
                            />
                          )}
                          {selectedAgent && currentSession?.harness && (
                            <SessionLeaseNote
                              agentId={selectedAgent}
                              harness={currentSession.harness}
                              provider={currentSession.provider ?? null}
                            />
                          )}
                        </div>
                      </ChatColumn>
                    </div>
                  )}
              </div>
            </>
          )}
        </div>

        {}
        {sidePanelOpen && (
          <>
            <div className={sidePanelFills ? "hidden" : "hidden md:flex"}>
              <ResizeHandle
                side="right"
                onResize={(d) => {
                  const max = Math.min(
                    960,
                    sidePanelMaxW ?? window.innerWidth - 500,
                  );
                  const base = Math.min(
                    rightWRef.current ?? filePanelRef.current?.offsetWidth ?? 0,
                    max,
                  );
                  const v = Math.max(240, Math.min(max, base + d));
                  rightWRef.current = v;
                  writePersistedNumber(FILE_PANEL_WIDTH_KEY, v);
                  setRightW(v);
                }}
              />
            </div>
            <div
              ref={filePanelRef}
              style={
                sidePanelW !== null
                  ? ({ "--file-w": `${sidePanelW}px` } as CSSProperties)
                  : undefined
              }
              className={cn(
                "flex flex-col overflow-hidden bg-background relative z-content max-md:fixed max-md:inset-0 max-md:z-overlay",
                sidePanelFills
                  ? "md:flex-1 md:min-w-0"
                  : sidePanelW !== null
                    ? "md:shrink-0 md:w-[var(--file-w)]"
                    : "md:flex-1 md:basis-0 md:min-w-0",
                "md:border-l md:border-border",
              )}
            >
              {openBrowserAgentId && canOpenBrowser ? (
                <DockedBrowserPanel
                  key={openBrowserAgentId}
                  agentId={openBrowserAgentId}
                  agentName={selectedAgentName ?? openBrowserAgentId}
                />
              ) : openDelegation ? (
                <DockedDelegationPanel
                  key={openDelegation.id}
                  driverAgentId={openDelegation.driverAgentId}
                  id={openDelegation.id}
                />
              ) : openFilePath ? (
                <DockedFilePanel onOpenFile={openFileHandler} />
              ) : openArtifactId ? (
                <DockedArtifactPanel
                  key={openArtifactId}
                  agentId={selectedAgent}
                  onSendPrompt={sendArtifactPrompt}
                />
              ) : openProcessOutputKey && selectedAgent ? (
                <DockedProcessOutputPanel
                  key={openProcessOutputKey}
                  agentId={selectedAgent}
                  outputKey={openProcessOutputKey}
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
  processesEnabled,
}: {
  selectedAgent: string | null;
  agents: AgentView[];
  busy: boolean;
  connectionState: ConnectionState;
  sessionId: string | null;
  processesEnabled: boolean;
}) {
  const agent = agents.find((a) => a.id === selectedAgent);
  const backgroundWork = useSessionBackgroundWork(selectedAgent, sessionId);
  const reconnecting =
    connectionState === "reconnecting" || connectionState === "reloading";
  return (
    <>
      {processesEnabled ? (
        <ProcessesIndicator agentId={selectedAgent} />
      ) : (
        <BackgroundWorkIndicator items={backgroundWork} />
      )}
      {reconnecting && <Badge variant="warning">Reconnecting</Badge>}
      <ImportInProgressBadge agentId={selectedAgent} />
      {agent && <GatewayFailureBadge agent={agent} />}
      {!busy && agent && (
        <>
          <ContributionFailuresBadge failures={agentFailures(agent)} />
          <UnsupportedContributionsBadge agent={agent} />
        </>
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

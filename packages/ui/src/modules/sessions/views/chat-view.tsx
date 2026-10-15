import {
  ArrowDown,
  ArrowLeft,
  Document,
  Renew,
  Tools,
  TrashCan,
  Warning,
} from "@carbon/icons-react";
import { routesSessionPairs } from "agent-runtime-api";
import {
  SessionMode,
  SessionType,
  TELEMETRY_MAX_SINCE_HOURS,
} from "api-server-api";
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
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { ResizeHandle } from "../../../components/resize-handle.js";
import { useNow } from "../../../hooks/use-now.js";
import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { AgentView, Message } from "../../../types.js";
import { A2uiActionProvider } from "../../a2ui/contexts/a2ui-action-context.js";
import { A2uiConversationProvider } from "../../a2ui/contexts/a2ui-conversation-context.js";
import { useA2uiAutoReplies } from "../../a2ui/hooks/use-a2ui-auto-replies.js";
import { useA2uiConversation } from "../../a2ui/hooks/use-a2ui-conversation.js";
import { useChatFormsEnabled } from "../../a2ui/hooks/use-chat-forms-enabled.js";
import {
  COMPOSER_LOCKED_REASON,
  composerLocked,
} from "../../a2ui/lib/composer-lock.js";
import { isQueuedSend, rewritePointsOf } from "../../acp/session-projection.js";
import {
  useHarnessConfigCurrent,
  useHarnessConfigStatus,
} from "../../agents/api/harness-config.js";
import {
  useAgents,
  useIsAgentInaccessible,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { AgentInaccessibleOverlay } from "../../agents/components/agent-inaccessible-overlay.js";
import {
  AgentStartNotice,
  hasStartNotice,
} from "../../agents/components/agent-start-notice.js";
import { AgentUnavailableOverlay } from "../../agents/components/agent-unavailable-overlay.js";
import { avatarMood } from "../../agents/components/avatar/agent-avatar.js";
import {
  agentFailures,
  ContributionFailuresBadge,
} from "../../agents/components/contribution-failures-badge.js";
import { ContributionGapNotice } from "../../agents/components/contribution-gap-notice.js";
import { EditableAgentIdentity } from "../../agents/components/editable-agent-identity.js";
import { GatewayFailureBadge } from "../../agents/components/gateway-failure-badge.js";
import { RuntimeOutdatedNotice } from "../../agents/components/runtime-outdated-notice.js";
import { UnsupportedContributionsBadge } from "../../agents/components/unsupported-contributions-badge.js";
import { VmRuntimeBadge } from "../../agents/components/vm-runtime-badge.js";
import { WorkspaceFailureNotice } from "../../agents/components/workspace-failure-notice.js";
import { useAgentReachability } from "../../agents/hooks/use-agent-reachability.js";
import { useAutoWakeOnOpen } from "../../agents/hooks/use-auto-wake-on-open.js";
import { useHarnessConfigWatch } from "../../agents/hooks/use-harness-config-watch.js";
import { usePublicAgentFallback } from "../../agents/hooks/use-public-agent-fallback.js";
import { useSyncRestartingAgents } from "../../agents/hooks/use-restart-agent.js";
import { useSlowStartIds } from "../../agents/hooks/use-slow-start.js";
import { startsInChat } from "../../agents/lib/agent-start.js";
import { resolveAgentDisplay } from "../../agents/utils/agent-resolver.js";
import { ChatArtifactsPanel } from "../../artifacts/components/chat-artifacts-panel.js";
import { DockedArtifactPanel } from "../../artifacts/components/docked-artifact-panel.js";
import { DockedBrowserPanel } from "../../browser/components/docked-browser-panel.js";
import { useOpenBrowser } from "../../browser/hooks/use-auto-open-browser.js";
import { DockedChangesPanel } from "../../changes/components/docked-changes-panel.js";
import { SessionPullRequests } from "../../changes/components/session-pull-requests.js";
import { useToggleChanges } from "../../changes/hooks/use-toggle-changes.js";
import { useFeatures } from "../../features/api/queries.js";
import { DockedFilePanel } from "../../files/components/docked-file-panel.js";
import { FilesPanel } from "../../files/components/files-panel.js";
import { HomeVolumeBar } from "../../files/components/home-volume-bar.js";
import { ImportInProgressBadge } from "../../files/components/import-in-progress-badge.js";
import { useFileTree } from "../../files/hooks/use-file-tree.js";
import { GettingStartedDock } from "../../getting-started/components/getting-started-dock.js";
import { ApprovalsButton } from "../../home/components/approvals-button.js";
import {
  DelegationOwnersProvider,
  useDelegationOwners,
} from "../../invocations/components/delegation-owners.js";
import { DockedDelegationPanel } from "../../invocations/components/docked-delegation-panel.js";
import { LiveDelegationBlock } from "../../invocations/components/live-delegation-block.js";
import { MobileMenuButton } from "../../platform/components/sidebar/mobile-menu-button.js";
import { DockedProcessOutputPanel } from "../../processes/components/docked-process-output-panel.js";
import { ProcessesIndicator } from "../../processes/components/processes-indicator.js";
import { ProcessesPanel } from "../../processes/components/processes-panel.js";
import { useProcessesEnabled } from "../../processes/hooks/use-processes-enabled.js";
import { useProcessesLiveUpdates } from "../../processes/hooks/use-processes-live-updates.js";
import { useRunningProcesses } from "../../processes/hooks/use-running-processes.js";
import { ProviderSettingsModal } from "../../providers/components/provider-settings-modal.js";
import { AgentUsageActions } from "../../sandboxes/components/agent-usage-actions.js";
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
import { useProviderConnections } from "../api/session-pair.js";
import { BackgroundWorkIndicator } from "../components/background-work-indicator.js";
import { ChatColumn } from "../components/chat-column.js";
import { ChatInputArea } from "../components/chat-input-area.js";
import { ChatMessage } from "../components/chat-message.js";
import { ModelIndicator } from "../components/model-indicator.js";
import { PermissionStatusLine } from "../components/permission-prompt.js";
import { QueuedPrompts } from "../components/queued-prompts.js";
import {
  RewritableMessage,
  RewriteMarker,
} from "../components/rewritable-message.js";
import { SessionPairOutdatedNotice } from "../components/session-pair-outdated-notice.js";
import { SessionPairPicker } from "../components/session-pair-picker.js";
import { SessionPairPlaceholder } from "../components/session-pair-placeholder.js";
import { SidePanelBar } from "../components/side-panel-bar.js";
import { Terminal } from "../components/terminal.js";
import type { ConnectionState } from "../hooks/use-acp-connection.js";
import { useAcpSession } from "../hooks/use-acp-session.js";
import { useChatArtifactPrompt } from "../hooks/use-chat-artifact-prompt.js";
import { useChatFormPrompt } from "../hooks/use-chat-form-prompt.js";
import { useDeleteUndelivered } from "../hooks/use-delete-undelivered.js";
import { useOpenInitializationSession } from "../hooks/use-open-initialization-session.js";
import { useHasPendingPermission } from "../hooks/use-pending-permissions.js";
import {
  pushSessionPath,
  useSessionUrlSync,
} from "../hooks/use-session-url-sync.js";
import { useSessionWatch } from "../hooks/use-session-watch.js";
import { draftKey } from "../lib/draft-key.js";
import { newLiveArrivals, noteArrivals } from "../lib/live-arrivals.js";
import {
  type DockedItems,
  dockedItemTab,
  selectSidePanelTab,
  type SidePanelTab,
  visibleSidePanelTab,
} from "../lib/side-panel.js";
import {
  dividerLabel,
  threadItems,
  timeProps,
  userRunsOf,
} from "../lib/thread-items.js";
import { clearUndelivered } from "../lib/undelivered-store.js";
import type { SessionError } from "../store/sessions.js";

const FILE_PANEL_WIDTH_KEY = "platform-file-w";
const CHAT_MIN_W = 320;
const SIDE_PANEL_MIN_W = 320;
const SIDE_PANEL_BAR_W = 44;
const TELEMETRY_SETTLE_MS = 5 * 60_000;

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
  useHarnessConfigWatch(selectedAgent);
  useAutoWakeOnOpen(selectedAgent);
  const restartingAgents = useStore((s) => s.restartingAgents);
  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const agentView = agents.find((a) => a.id === selectedAgent) ?? null;
  const runtimeOutdated = agentView?.features.liveUpdates === false;
  const agentDisplay = agentView
    ? resolveAgentDisplay(agentView, restartingIds, slowStartIds)
    : null;
  const selectedAgentName = agentView?.name ?? selectedAgent;
  const agentStarting =
    agentDisplay?.state === "starting" ||
    agentDisplay?.state === "preparing_workspace";
  const startNotice = agentStarting &&
    agentView &&
    agentDisplay &&
    hasStartNotice(agentView, agentDisplay) && (
      <AgentStartNotice agent={agentView} display={agentDisplay} />
    );
  const sessionId = useStore((s) => s.sessionId);
  const sessionMode = useStore((s) => s.sessionMode);
  const setSessionMode = useStore((s) => s.setSessionMode);
  const setSessionId = useStore((s) => s.setSessionId);
  const messages = useStore((s) => s.messages);
  const shown = useMemo(
    () => messages.filter((m) => !isQueuedSend(m)),
    [messages],
  );
  const now = useNow(60_000);
  const runStarts = useStore((s) => s.runStarts);
  const items = useMemo(
    () => threadItems(shown, runStarts),
    [shown, runStarts],
  );
  const userRuns = useMemo(() => userRunsOf(items), [items]);
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
  const openChangesAgentId = useStore((s) =>
    s.openChangesAgentId === s.selectedAgent ? s.openChangesAgentId : null,
  );
  const toggleChanges = useToggleChanges();
  const browserMaximized = useStore((s) => s.browserMaximized);
  const openDelegation = useStore((s) =>
    s.openDelegation?.driverAgentId === s.selectedAgent
      ? s.openDelegation
      : null,
  );
  const processesEnabled = useProcessesEnabled();
  const storedProcessOutputKey = useStore((s) => s.openProcessOutputKey);
  const openProcessOutputKey = processesEnabled ? storedProcessOutputKey : null;
  useProcessesLiveUpdates(selectedAgent, processesEnabled);
  const runningProcesses = useRunningProcesses(
    processesEnabled ? selectedAgent : null,
  );
  const goBack = useStore((s) => s.goBack);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const sidePanelTab = useStore((s) => s.sidePanelTab);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const draftDocked = useStore((s) => s.openFileDirty || s.openArtifactDirty);
  const hasPendingPermission = useHasPendingPermission();
  const mobileScreen = useStore((s) => s.mobileScreen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const setApprovalsOpen = useStore((s) => s.setApprovalsOpen);
  const terminalPaused = useStore((s) => s.terminalPaused);
  const setTerminalPaused = useStore((s) => s.setTerminalPaused);

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
  const terminalFreshRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    resetSession,
    resumeSession,
    loadOlderMessages,
    sendPrompt,
    rewriteFrom,
    stopAgent,
    chooseSessionModel,
    configureSession,
    busy,
    loadingSession,
    connectionState,
  } = useAcpSession(selectedAgent, textareaRef);

  const promptGate = {
    agentId: selectedAgent,
    sessionId,
    sessionMode,
    agentOperable,
    loadingSession,
    sendPrompt,
  };
  const sendArtifactPrompt = useChatArtifactPrompt(promptGate);

  const { openFileHandler } = useFileTree(selectedAgent);
  const { data: harnessCurrent } = useHarnessConfigCurrent(selectedAgent);
  const harnessStatusQuery = useHarnessConfigStatus(selectedAgent);
  const harnessStatus = harnessStatusQuery.data;
  const { data: currentSession } = useAgentSession(selectedAgent, sessionId);
  const carried = (selectedAgent && harnessStatus?.harnesses) || [];
  const pairOutdated = carried.length > 0 && !routesSessionPairs(carried);
  const harnessesPending =
    !harnessStatus?.harnesses &&
    !harnessStatus?.catalog &&
    (harnessStatusQuery.isPending || !agentOperable);
  const newSessionAgent =
    !sessionId && (carried.length > 0 || harnessesPending)
      ? selectedAgent
      : null;
  const pendingPairAgent = harnessesPending ? newSessionAgent : null;
  const pickable =
    newSessionAgent && carried.length > 0 && !pairOutdated
      ? {
          agentId: newSessionAgent,
          carried,
          defaultHarness: harnessStatus?.defaultHarness ?? carried[0]!.name,
          routed: harnessStatus?.modelRouter ?? false,
        }
      : null;
  const providerConnections = useProviderConnections(newSessionAgent);
  const noProviders =
    !!newSessionAgent &&
    providerConnections.loaded &&
    providerConnections.owned.length === 0;
  const noGrantedProvider =
    !!newSessionAgent &&
    providerConnections.loaded &&
    providerConnections.granted.length === 0;
  const [providersModal, setProvidersModal] = useState<boolean | null>(null);

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

  const harnessForks = useStore((s) => s.harnessForks);
  const queueEmpty = useStore((s) => s.queuedPrompts.length === 0);
  const { data: sessionView } = useAgentSession(selectedAgent, sessionId);
  const canRewrite =
    harnessForks &&
    sessionView?.mode === SessionMode.Chat &&
    sessionView.type === SessionType.Regular &&
    !sessionView.threadTs &&
    !sessionView.scheduleId &&
    !sessionView.initialization;
  const arrivalsRef = useRef(newLiveArrivals(sessionId));
  if (arrivalsRef.current.sessionId !== sessionId)
    arrivalsRef.current = newLiveArrivals(sessionId);
  const arrived = noteArrivals(arrivalsRef.current, shown, loadingSession);
  const rewritePoints = useMemo(() => rewritePointsOf(shown), [shown]);
  const rewriting = useStore((s) => s.rewriting);
  const rewriteIndex = rewriting
    ? shown.findIndex((m) => m.id === rewriting.messageId)
    : -1;

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

  const sendFormPrompt = useChatFormPrompt({
    ...promptGate,
    sendPrompt: sendAndFollow,
  });
  const chatFormsEnabled = useChatFormsEnabled();
  const a2uiConversation = useA2uiConversation(
    messages,
    sessionId ?? "",
    chatFormsEnabled,
  );
  const { withRendererMetadata } = a2uiConversation;
  const formLocksComposer = composerLocked(
    a2uiConversation.conversation,
    a2uiConversation.liveMessageId,
  );
  useA2uiAutoReplies(a2uiConversation, sendFormPrompt);
  const sendWithA2uiData = useCallback(
    (...[text, ...rest]: Parameters<typeof sendPrompt>) =>
      sendAndFollow(withRendererMetadata(text), ...rest),
    [sendAndFollow, withRendererMetadata],
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

  const historyShown = !loadingSession || messages.length > 0;
  useLayoutEffect(() => {
    if (!historyShown) return;
    const el = messagesRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, [historyShown, sessionId]);

  const pendingResumeSessionId = useStore((s) => s.pendingResumeSessionId);
  const setPendingResumeSessionId = useStore(
    (s) => s.setPendingResumeSessionId,
  );
  const pendingResumeSessionMode = useStore((s) => s.pendingResumeSessionMode);
  const pendingResumeFresh = useStore((s) => s.pendingResumeFresh);
  useEffect(() => {
    if (!selectedAgent || !pendingResumeSessionId) return;
    const sid = pendingResumeSessionId;
    const mode = pendingResumeSessionMode;
    setPendingResumeSessionId(null);
    if (mode === SessionMode.Terminal) {
      terminalFreshRef.current = pendingResumeFresh;
      setSessionMode(mode);
      setSessionId(sid);
      return;
    }
    resumeSession(sid);
  }, [
    selectedAgent,
    pendingResumeSessionId,
    pendingResumeSessionMode,
    pendingResumeFresh,
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

  const openSession = useCallback(
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

  const [pairPickerOpen, setPairPickerOpen] = useState(false);
  useEffect(() => {
    if (sessionId) setPairPickerOpen(false);
  }, [sessionId]);
  const handleNewSession = useCallback(
    (pickPair = false) => {
      const afterReset = () =>
        pickPair
          ? setPairPickerOpen(true)
          : requestAnimationFrame(() => textareaRef.current?.focus());
      if (selectedAgent) clearUndelivered(draftKey(selectedAgent, null));
      if (!sessionId && messages.length === 0) {
        setMobileScreen("chat");
        afterReset();
        return;
      }
      pushSessionUrl(null, null);
      setSessionMode(SessionMode.Chat);
      resetSession();
      setMobileScreen("chat");
      afterReset();
    },
    [
      selectedAgent,
      sessionId,
      messages.length,
      resetSession,
      setMobileScreen,
      setSessionMode,
      pushSessionUrl,
    ],
  );

  const chatRequest = useStore((s) => s.chatRequest);
  const requestChat = useStore((s) => s.requestChat);
  useEffect(() => {
    if (!chatRequest) return;
    requestChat(null);
    if (chatRequest.kind === "new") handleNewSession();
    else openSession(chatRequest.sessionId, chatRequest.mode ?? undefined);
  }, [chatRequest, requestChat, handleNewSession, openSession]);

  const handleNewTerminal = useCallback(() => {
    resetSession();
    const id = crypto.randomUUID();
    terminalFreshRef.current = true;
    setSessionMode(SessionMode.Terminal);
    setSessionId(id);
    setMobileScreen("chat");
  }, [resetSession, setSessionId, setSessionMode, setMobileScreen]);

  const canOpenBrowser = agentView?.requireConnectionAddress === true;
  const docked: DockedItems = {
    file: openFilePath !== null,
    artifact: openArtifactId !== null,
    processOutput: openProcessOutputKey !== null && selectedAgent !== null,
    changes: openChangesAgentId !== null,
    browser: openBrowserAgentId !== null && canOpenBrowser,
    delegation: openDelegation !== null,
  };
  const activeTab = visibleSidePanelTab(sidePanelTab, docked, {
    canOpenBrowser,
    processesEnabled,
  });
  const dockedTab = dockedItemTab(docked);
  const dockedShown = dockedTab !== null && dockedTab === activeTab;
  const dockedKept = dockedTab !== null && (dockedShown || draftDocked);
  const sidePanelOpen = activeTab !== null;
  const mobileOnPanel = sidePanelOpen && mobileScreen === "files";
  const mobilePanelOpen = mobileOnPanel || (sidePanelOpen && dockedShown);
  const hiddenTabs = new Set<SidePanelTab>([
    ...(canOpenBrowser ? [] : (["browser"] as const)),
    ...(processesEnabled ? [] : (["processes"] as const)),
  ]);
  const onSidePanelTab = (tab: SidePanelTab) => {
    const selection = selectSidePanelTab(tab, activeTab, docked);
    if (selection.kind === "collapse") setSidePanelTab(null);
    else if (selection.kind === "show") setSidePanelTab(selection.tab);
    else if (!selectedAgent) return;
    else if (selection.kind === "open-changes")
      void toggleChanges(selectedAgent);
    else void openBrowser(selectedAgent);
  };
  const browserFills = browserMaximized && activeTab === "browser";
  const columnsDoNotFit =
    columnsW !== null &&
    columnsW < CHAT_MIN_W + SIDE_PANEL_MIN_W + SIDE_PANEL_BAR_W;
  const sidePanelFills = browserFills || (sidePanelOpen && columnsDoNotFit);
  const sidePanelMaxW =
    columnsW === null ? null : columnsW - CHAT_MIN_W - SIDE_PANEL_BAR_W;
  const sidePanelW =
    rightW !== null && sidePanelMaxW !== null
      ? Math.min(rightW, Math.max(SIDE_PANEL_MIN_W, sidePanelMaxW))
      : rightW;
  const handleConfigureSandbox = useCallback(() => {
    if (!selectedAgent) return;
    navigateToSandboxHome(selectedAgent);
  }, [selectedAgent, navigateToSandboxHome]);

  const openApprovals = useCallback(
    () => setApprovalsOpen(true),
    [setApprovalsOpen],
  );

  const handleBack = useCallback(() => {
    resetSession();
    goBack();
  }, [resetSession, goBack]);

  const dotColor = agentDisplay
    ? stateDotClass[agentDisplay.state]
    : "bg-warning";

  const lastMessage = shown[shown.length - 1];
  const statusLineInThread =
    lastMessage?.role === "assistant" && !lastMessage.notice;

  return (
    <div className="flex flex-col h-dvh bg-background relative overflow-hidden">
      {}
      {(providersModal ?? noProviders) && (
        <ProviderSettingsModal
          agentId={newSessionAgent}
          onClose={() => setProvidersModal(false)}
        />
      )}
      {}
      <div ref={setColumnsEl} className="flex flex-1 min-h-0">
        {}
        <div
          className={`@container/chat relative flex flex-1 flex-col min-w-0 ${mobileOnPanel ? "hidden md:flex" : "flex"} ${sidePanelFills ? "md:!hidden" : ""}`}
        >
          <header className="@container relative z-raised flex shrink-0 items-center gap-2 px-4 max-md:h-[52px] max-md:border-b max-md:border-border md:pointer-events-none md:absolute md:inset-x-0 md:top-0 md:h-[70px]">
            <div className="flex min-w-0 items-center gap-3 max-md:flex-1 md:pointer-events-auto">
              <MobileMenuButton />
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  agentView && "hidden @max-[149px]:block",
                  dotColor,
                )}
              />
              {agentView ? (
                <EditableAgentIdentity
                  agent={agentView}
                  avatarSize={32}
                  mood={avatarMood(agentDisplay?.state, agentView)}
                  avatarClassName="@max-[149px]:hidden"
                  nameClassName="text-sm font-bold text-foreground"
                />
              ) : (
                <h1 className="text-sm font-bold text-foreground truncate">
                  {selectedAgentName}
                </h1>
              )}
              {agentView && (
                <span className="flex shrink-0 empty:hidden @max-[119px]:hidden">
                  <VmRuntimeBadge
                    agent={agentView}
                    labelClassName="@max-[279px]:sr-only"
                  />
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Configure agent"
                tooltip="Configure agent"
                data-testid="configure-agent"
                className="-ml-2 shrink-0 max-md:hidden"
                onClick={handleConfigureSandbox}
              >
                <Tools size={16} />
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-2 md:pointer-events-auto">
              <ChatHeaderStatus
                selectedAgent={selectedAgent}
                agents={agents}
                busy={busy}
                connectionState={connectionState}
                sessionId={sessionId}
                processesEnabled={processesEnabled}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Files and artifacts"
                data-testid="open-agent-files"
                className="md:hidden"
                onClick={() => {
                  if (!sidePanelOpen) setSidePanelTab("files");
                  setMobileScreen("files");
                }}
              >
                <Document size={16} />
              </Button>
              <div className="md:hidden">
                <ApprovalsButton onOpen={openApprovals} />
              </div>
            </div>
          </header>
          <div className="peer/notices empty:hidden md:pt-[70px]">
            {runtimeOutdated && (
              <RuntimeOutdatedNotice agentId={selectedAgent} />
            )}
            <ContributionGapNotice agentId={selectedAgent} />
            <WorkspaceFailureNotice agentId={selectedAgent} />
          </div>
          {}
          {sessionMode === SessionMode.Terminal &&
          selectedAgent &&
          sessionId ? (
            <div className="flex min-h-0 flex-1 flex-col md:peer-empty/notices:pt-[70px]">
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
                onSubmit={() =>
                  setSessionRunning(selectedAgent, sessionId, true)
                }
                onSessionMoved={setSessionId}
              />
            </div>
          ) : (
            <>
              <div className="@container relative flex flex-1 flex-col min-h-0 md:peer-empty/notices:[--chat-top:70px]">
                <div ref={messagesRef} className="flex-1 overflow-y-auto">
                  <ChatColumn className="px-2 @xs/chat:px-4 @xl/chat:px-8 py-8 md:pt-[max(2rem,var(--chat-top,0px))] flex flex-col gap-8 min-h-full">
                    {!historyShown && (
                      <div className="py-20 flex items-center justify-center gap-3 text-sm text-muted-foreground">
                        <Spinner size={20} />
                        Loading session…
                      </div>
                    )}
                    {loadingSession && startNotice && (
                      <div className="flex justify-center">{startNotice}</div>
                    )}
                    {!loadingSession && sessionError && (
                      <SessionErrorCard
                        error={sessionError}
                        onRetry={() => resumeSession(sessionError.sessionId)}
                        onDelete={async () => {
                          if (!(await deleteSession(sessionError.sessionId)))
                            return;
                          setSessionError(null);
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
                          {agentView && (
                            <div className="mt-5 w-full max-w-[640px] text-left">
                              <AgentUsageActions
                                agent={agentView}
                                showChat={false}
                                onNewTerminal={handleNewTerminal}
                              />
                            </div>
                          )}
                          {startNotice && (
                            <div className="mt-6">{startNotice}</div>
                          )}
                        </div>
                      )}
                    <A2uiActionProvider value={sendFormPrompt}>
                      <A2uiConversationProvider value={a2uiConversation}>
                        <DelegationOwnersProvider value={delegationOwners}>
                          {items.map((item) => {
                            if (item.kind === "divider") {
                              return (
                                <div
                                  key={item.key}
                                  className="flex items-center gap-3 py-2"
                                >
                                  <span className="h-px flex-1 bg-border/60" />
                                  <span className="text-2xs text-muted-foreground">
                                    {dividerLabel(item, now)}
                                  </span>
                                  <span className="h-px flex-1 bg-border/60" />
                                </div>
                              );
                            }
                            if (userRuns.inner.has(item.message.id))
                              return null;
                            const turn = turnForMessage.get(item.message.id);
                            const members = userRuns.runs.get(
                              item.message.id,
                            ) ?? [item.message];
                            const lastIndex = item.index + members.length - 1;
                            const bubbles = members.map((m, k) => (
                              <ChatMessage
                                key={m.id}
                                message={m}
                                continued={k > 0}
                                arriving={arrived.has(m.id)}
                                avatarAgent={agentView ?? undefined}
                                isLast={item.index + k === shown.length - 1}
                                showModel={runStarts.length > 0}
                                {...timeProps(m.at, now)}
                                hasPendingPermission={hasPendingPermission}
                                pendingNotice={
                                  item.index + k === shown.length - 1
                                    ? startNotice
                                    : undefined
                                }
                                onRetry={sendPrompt}
                                onFileClick={openFileHandler}
                                onDelete={deleteMessage}
                                onLoadOlder={loadOlderKeepingScroll}
                              />
                            ));
                            const chatMessage =
                              members.length === 1 ? (
                                bubbles[0]
                              ) : (
                                <div className="flex flex-col gap-2">
                                  {bubbles}
                                </div>
                              );
                            const runMessage: Message =
                              members.length === 1
                                ? item.message
                                : {
                                    ...item.message,
                                    parts: members.flatMap((m) =>
                                      m.parts.filter((p) => p.kind === "text"),
                                    ),
                                  };
                            const upTo = rewritePoints.get(item.message.id);
                            const editingHere =
                              rewriting?.messageId === item.message.id;
                            const doomed =
                              rewriting?.mode === "rewind" &&
                              rewriteIndex !== -1 &&
                              item.index > rewriteIndex;
                            const content =
                              canRewrite &&
                              rewritePoints.has(item.message.id) ? (
                                <RewritableMessage
                                  message={runMessage}
                                  enabled={queueEmpty && !busy}
                                  onRewrite={(mode, text) =>
                                    rewriteFrom({
                                      messageId: item.message.id,
                                      upToMessageId: upTo,
                                      mode,
                                      text,
                                      title: sessionView?.title ?? null,
                                    })
                                  }
                                >
                                  {chatMessage}
                                </RewritableMessage>
                              ) : (
                                chatMessage
                              );
                            return (
                              <Fragment key={item.message.id}>
                                {doomed ? (
                                  <div className="opacity-30 grayscale">
                                    {content}
                                  </div>
                                ) : (
                                  content
                                )}
                                {editingHere && rewriting && (
                                  <RewriteMarker
                                    mode={rewriting.mode}
                                    following={shown.length - 1 - lastIndex}
                                  />
                                )}
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
                      </A2uiConversationProvider>
                    </A2uiActionProvider>
                    {selectedAgent && (
                      <LiveDelegationBlock
                        driverAgentId={selectedAgent}
                        busy={busy}
                        claimed={delegationOwners}
                      />
                    )}
                    <QueuedPrompts onFileClick={openFileHandler} />
                    {telemetryEnabled && sessionTurns.isError && (
                      <p className="py-1 text-2xs text-muted-foreground/70">
                        Telemetry for this session could not be read.
                      </p>
                    )}
                    {turnsUnavailable && (
                      <p className="py-1 text-2xs text-muted-foreground/70">
                        {turnsUnavailable}
                      </p>
                    )}
                    {turnsTruncated && (
                      <p className="py-1 text-2xs text-muted-foreground/70">
                        Older turns in this session are past the telemetry
                        display cap and are not shown.
                      </p>
                    )}
                    {!statusLineInThread && <PermissionStatusLine />}
                  </ChatColumn>
                </div>

                <GettingStartedDock placement="chat" />
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
                <HomeVolumeBar agentId={selectedAgent} />
                <ChatInputArea
                  textareaRef={textareaRef}
                  busy={busy}
                  loadingSession={loadingSession}
                  onSend={sendWithA2uiData}
                  onStop={stopAgent}
                  blockedReason={
                    noGrantedProvider
                      ? "No LLM provider connected to this agent."
                      : formLocksComposer
                        ? COMPOSER_LOCKED_REASON
                        : null
                  }
                />
                {!hasPendingPermission && pickable && (
                  <div className="px-2 @xs/chat:px-4 @xl/chat:px-8">
                    <ChatColumn>
                      <SessionPairPicker
                        {...pickable}
                        open={pairPickerOpen}
                        onOpenChange={setPairPickerOpen}
                        onConnectProviders={() => setProvidersModal(true)}
                      />
                    </ChatColumn>
                  </div>
                )}
                {!hasPendingPermission && pendingPairAgent && (
                  <div className="px-2 @xs/chat:px-4 @xl/chat:px-8">
                    <ChatColumn>
                      <SessionPairPlaceholder
                        agentId={pendingPairAgent}
                        agentHarness={agentView?.harness}
                        open={pairPickerOpen}
                        onOpenChange={setPairPickerOpen}
                        onConnectProviders={() => setProvidersModal(true)}
                      />
                    </ChatColumn>
                  </div>
                )}
                {!hasPendingPermission && !pickable && !pendingPairAgent && (
                  <div className="px-2 @xs/chat:px-4 @xl/chat:px-8">
                    <ChatColumn>
                      {selectedAgent && pairOutdated ? (
                        <SessionPairOutdatedNotice agentId={selectedAgent} />
                      ) : selectedAgent && currentSession?.harness ? (
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <ModelIndicator
                            agentId={selectedAgent}
                            harness={currentSession.harness}
                            provider={currentSession.provider ?? null}
                            model={currentSession.model ?? null}
                            settings={currentSession.settings}
                            carried={harnessStatus?.harnesses ?? []}
                            routed={harnessStatus?.modelRouter ?? false}
                            turnRunning={busy}
                            onChoose={(value) => void chooseSessionModel(value)}
                            onConfigure={(change) =>
                              void configureSession(change)
                            }
                            onNewSession={() => handleNewSession(true)}
                          />
                          <SessionPullRequests
                            repositories={currentSession.repositories}
                          />
                        </div>
                      ) : selectedAgent ? (
                        <Button
                          variant="link"
                          size="inline"
                          tone="muted"
                          className="pl-3 text-sm"
                          onClick={() =>
                            navigateToSandboxHome(selectedAgent, "setup")
                          }
                        >
                          {harnessCurrent?.model
                            ? `${harnessCurrent.model} · Configure defaults`
                            : "Configure defaults"}
                        </Button>
                      ) : null}
                    </ChatColumn>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {}
        {sidePanelOpen && !sidePanelFills && (
          <div className="hidden md:flex">
            <ResizeHandle
              side="right"
              onResize={(d) => {
                const max = sidePanelMaxW ?? window.innerWidth - 500;
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
        )}
        <div
          data-testid="side-panel"
          className={cn(
            "flex bg-background relative z-content max-md:fixed max-md:inset-0 max-md:z-overlay",
            !mobilePanelOpen && "max-md:hidden",
            sidePanelFills
              ? "md:flex-1 md:min-w-0"
              : sidePanelOpen && sidePanelW === null
                ? "md:flex-1 md:basis-0 md:min-w-0"
                : "md:shrink-0",
          )}
        >
          {(sidePanelOpen || dockedKept) && (
            <div
              ref={filePanelRef}
              style={
                sidePanelW !== null
                  ? ({ "--file-w": `${sidePanelW}px` } as CSSProperties)
                  : undefined
              }
              className={cn(
                "flex flex-col min-w-0 overflow-hidden max-md:flex-1",
                !sidePanelOpen && "hidden",
                sidePanelFills || sidePanelW === null
                  ? "md:flex-1"
                  : "md:shrink-0 md:w-[var(--file-w)]",
                "md:border-l md:border-border",
              )}
            >
              <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Back to chat"
                  onClick={() => {
                    setSidePanelTab(null);
                    setMobileScreen("chat");
                  }}
                >
                  <ArrowLeft size={16} />
                </Button>
                <span className="truncate text-sm font-bold text-foreground">
                  {selectedAgentName}
                </span>
              </div>
              {!dockedShown && activeTab === "files" && (
                <FilesPanel
                  open
                  className="flex-1"
                  onOpenFile={openFileHandler}
                />
              )}
              {!dockedShown && activeTab === "artifacts" && (
                <ChatArtifactsPanel
                  agentId={selectedAgent}
                  open
                  className="flex-1"
                />
              )}
              {!dockedShown && activeTab === "processes" && (
                <ProcessesPanel
                  agentId={selectedAgent}
                  alwaysOn={agentView?.hibernationTimeoutMin === 0}
                  open
                  className="flex-1"
                />
              )}
              {dockedKept && (
                <div
                  className={cn(
                    "flex flex-1 min-h-0 flex-col",
                    !dockedShown && "hidden",
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
                  ) : openChangesAgentId ? (
                    <DockedChangesPanel
                      key={`${openChangesAgentId}:${sessionId ?? ""}`}
                      agentId={openChangesAgentId}
                      sessionId={sessionId}
                    />
                  ) : openProcessOutputKey && selectedAgent ? (
                    <DockedProcessOutputPanel
                      key={openProcessOutputKey}
                      agentId={selectedAgent}
                      outputKey={openProcessOutputKey}
                    />
                  ) : null}
                </div>
              )}
            </div>
          )}
          <SidePanelBar
            active={activeTab}
            hidden={hiddenTabs}
            onSelect={onSidePanelTab}
            badges={
              runningProcesses
                ? {
                    processes: {
                      count: runningProcesses.running,
                      label: `Processes, ${String(runningProcesses.running)} running`,
                    },
                  }
                : undefined
            }
            footer={<ApprovalsButton onOpen={openApprovals} />}
          />
        </div>
      </div>

      {leavingForPublicPage ? (
        <AgentInaccessibleOverlay onLeave={goBack} />
      ) : selectedAgent &&
        !agentInaccessible &&
        !agentOperable &&
        !(
          agentView &&
          agentDisplay &&
          startsInChat(agentView, agentDisplay.state)
        ) ? (
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
        <span className="md:hidden">
          <ProcessesIndicator agentId={selectedAgent} />
        </span>
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
    body: "The agent didn't answer. It may be waking up or falling asleep — try again in a moment.",
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
          <h3 className="text-md font-bold text-foreground mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground break-words">{body}</p>
        </div>
      </div>
      {}
      {(error.kind === "connection" || error.kind === "orphaned") && (
        <div className="flex items-center gap-2 flex-wrap">
          {error.kind === "connection" ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <Renew size={14} /> Retry
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

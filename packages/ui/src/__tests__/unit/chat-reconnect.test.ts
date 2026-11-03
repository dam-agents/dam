// @vitest-environment happy-dom
// TEST_OVERVIEW: A running Agent whose connection dropped keeps its chat on screen: the takeover overlay is only for an Agent with no chat to keep, the chat shows a one-line reconnecting notice, and the chat refuses the two actions that need the live channel (a send and a permission answer) until the Agent answers again.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionMode } from "api-server-api";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  operable: false,
  state: "running" as string,
  connectionState: "reconnecting" as string,
  retryChannel: vi.fn(),
  busy: false,
  loadingSession: false,
  sendPrompt: vi.fn(async () => {}),
  stopAgent: vi.fn(async () => {}),
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const nullComponent = () => null;

function mockModule(path: string, exports: Record<string, unknown>): void {
  vi.doMock(path, () => exports);
}

const components = new Map<string, string[]>();
for (const [path, names] of [
  [
    "../../modules/agents/components/avatar/agent-avatar.js",
    ["AgentAvatar", "avatarMood"],
  ],
  [
    "../../modules/agents/components/agent-start-notice.js",
    ["AgentStartNotice", "hasStartNotice"],
  ],
  [
    "../../modules/agents/components/contribution-failures-badge.js",
    ["ContributionFailuresBadge", "agentFailures"],
  ],
  [
    "../../modules/agents/components/contribution-gap-notice.js",
    ["ContributionGapNotice"],
  ],
  [
    "../../modules/agents/components/workspace-failure-notice.js",
    ["WorkspaceFailureNotice"],
  ],
  [
    "../../modules/agents/components/runtime-outdated-notice.js",
    ["RuntimeOutdatedNotice"],
  ],
  [
    "../../modules/agents/components/gateway-failure-badge.js",
    ["GatewayFailureBadge"],
  ],
  [
    "../../modules/agents/components/unsupported-contributions-badge.js",
    ["UnsupportedContributionsBadge"],
  ],
  [
    "../../modules/agents/components/default-model-notice.js",
    ["DefaultModelNotice"],
  ],
  [
    "../../modules/agents/components/agent-inaccessible-overlay.js",
    ["AgentInaccessibleOverlay"],
  ],
  ["../../modules/sessions/components/chat-message.js", ["ChatMessage"]],
  [
    "../../modules/sessions/components/new-session-launcher.js",
    ["NewSessionOptions"],
  ],
  ["../../modules/sessions/components/queued-prompts.js", ["QueuedPrompts"]],
  ["../../modules/sessions/components/quiet-turn-line.js", ["QuietTurnLine"]],
  [
    "../../modules/sessions/components/provider-status-line.js",
    ["ProviderStatusLine"],
  ],
  ["../../modules/sessions/components/model-indicator.js", ["ModelIndicator"]],
  [
    "../../modules/sessions/components/background-work-indicator.js",
    ["BackgroundWorkIndicator"],
  ],
  [
    "../../modules/starter-kits/components/onboarding-bar.js",
    ["OnboardingBar"],
  ],
  ["../../modules/starter-kits/components/kit-update-bar.js", ["KitUpdateBar"]],
  ["../../modules/files/components/home-volume-bar.js", ["HomeVolumeBar"]],
  ["../../modules/files/components/docked-file-panel.js", ["DockedFilePanel"]],
  [
    "../../modules/files/components/import-in-progress-badge.js",
    ["ImportInProgressBadge"],
  ],
  [
    "../../modules/artifacts/components/docked-artifact-panel.js",
    ["DockedArtifactPanel"],
  ],
  [
    "../../modules/browser/components/docked-browser-panel.js",
    ["DockedBrowserPanel"],
  ],
  [
    "../../modules/changes/components/docked-changes-panel.js",
    ["DockedChangesPanel"],
  ],
  [
    "../../modules/invocations/components/docked-delegation-panel.js",
    ["DockedDelegationPanel"],
  ],
  [
    "../../modules/invocations/components/live-delegation-block.js",
    ["LiveDelegationBlock"],
  ],
  [
    "../../modules/processes/components/docked-process-output-panel.js",
    ["DockedProcessOutputPanel"],
  ],
  [
    "../../modules/processes/components/processes-indicator.js",
    ["ProcessesIndicator"],
  ],
  [
    "../../modules/getting-started/components/getting-started-dock.js",
    ["GettingStartedDock"],
  ],
  [
    "../../modules/changes/components/session-pull-requests.js",
    ["SessionPullRequests"],
  ],
  [
    "../../modules/sessions/components/side-panel-bar.js",
    ["SidePanelTabButtons", "appSidePanelTabs"],
  ],
  [
    "../../modules/sessions/components/session-pair-picker.js",
    ["SessionPairPicker"],
  ],
  [
    "../../modules/sessions/components/session-pair-outdated-notice.js",
    ["SessionPairOutdatedNotice"],
  ],
  [
    "../../modules/providers/components/provider-settings-modal.js",
    ["ProviderSettingsModal"],
  ],
  ["../../modules/sessions/components/terminal.js", ["Terminal"]],
  [
    "../../modules/sessions/components/rewritable-message.js",
    ["RewritableMessage", "RewriteMarker"],
  ],
  [
    "../../modules/sessions/components/continued-from-prelude.js",
    ["ContinuedFromPrelude", "ContinuedFromUnavailable"],
  ],
  [
    "../../modules/sessions/components/curve-bender-alert.js",
    ["CurveBenderAlert"],
  ],
  [
    "../../modules/sessions/components/setup-instructions-card.js",
    ["SetupInstructionsCard"],
  ],
  ["../../modules/sessions/components/thread-divider.js", ["ThreadDivider"]],
  [
    "../../modules/sessions/components/classic-chat-identity.js",
    ["ClassicChatIdentity"],
  ],
] as const)
  components.set(path, [...names]);

for (const [path, names] of components) {
  const exports: Record<string, unknown> = {};
  for (const name of names)
    exports[name as string] =
      name.startsWith("has") || name.startsWith("agent")
        ? () => false
        : nullComponent;
  mockModule(path, exports);
}

mockModule("../../modules/sessions/components/classic-chat-layout.js", {
  ClassicChatLayout: (props: {
    notices: unknown;
    status: unknown;
    children: unknown;
  }) =>
    createElement(
      "div",
      {},
      props.status as never,
      props.notices as never,
      props.children as never,
    ),
});
mockModule("../../modules/sessions/components/chat-column.js", {
  ChatColumn: (props: { children: unknown }) =>
    createElement("div", {}, props.children as never),
});
mockModule("../../modules/sessions/hooks/use-skill-commands.js", {
  useSkillCommands: () => [],
});
mockModule("../../modules/sessions/hooks/use-sender-names.js", {
  useSenderNames: () => ({
    viewerSub: null,
    otherName: () => null,
    nameOf: () => "",
  }),
});
mockModule("../../modules/sessions/hooks/use-session-url-sync.js", {
  useSessionUrlSync: vi.fn(),
  pushSessionPath: vi.fn(),
});
mockModule("../../modules/sessions/hooks/use-session-watch.js", {
  useSessionWatch: vi.fn(),
});
mockModule("../../modules/sessions/hooks/use-take-back.js", {
  useTakeBack: () => null,
});
mockModule("../../modules/sessions/hooks/use-new-session-choice.js", {
  useNewSessionChoice: () => ({
    choice: { kind: "none" },
    newSessionAgent: null,
    pair: null,
    pairHarness: null,
    noProviders: false,
    noGrantedProvider: false,
  }),
});
mockModule("../../modules/sessions/hooks/use-open-initialization-session.js", {
  useOpenInitializationSession: vi.fn(),
});
mockModule("../../modules/sessions/hooks/use-chat-scroll.js", {
  useChatScroll: () => ({
    messagesRef: { current: null },
    scrollToBottom: vi.fn(),
    loadOlderKeepingScroll: vi.fn(),
    showJump: false,
    historyShown: true,
  }),
});
mockModule("../../modules/sessions/hooks/use-chat-artifact-prompt.js", {
  useChatArtifactPrompt: () => vi.fn(),
});
mockModule("../../modules/sessions/hooks/use-chat-form-prompt.js", {
  useChatFormPrompt: () => vi.fn(),
});
mockModule("../../modules/sessions/hooks/use-curve-bender.js", {
  useCurveBender: () => ({ tryIt: vi.fn() }),
});
mockModule("../../modules/sessions/hooks/use-delete-undelivered.js", {
  useDeleteUndelivered: () => vi.fn(),
});
mockModule("../../modules/sessions/hooks/use-session-template-id.js", {
  useSessionTemplateId: () => undefined,
});
mockModule("../../modules/sessions/hooks/use-app-side-panel-tabs.js", {
  useAppSidePanelTabs: () => ({ tabs: [], active: null, onSelect: vi.fn() }),
});
mockModule("../../modules/sessions/hooks/use-acp-session.js", {
  useAcpSession: () => ({
    resetSession: vi.fn(),
    resumeSession: vi.fn(),
    loadOlderMessages: vi.fn(),
    sendPrompt: fake.sendPrompt,
    rewriteFrom: vi.fn(),
    takeBackPrompt: vi.fn(),
    stopAgent: fake.stopAgent,
    chooseSessionModel: vi.fn(),
    configureSession: vi.fn(),
    busy: fake.busy,
    loadingSession: fake.loadingSession,
    connectionState: fake.connectionState,
    retryChannel: fake.retryChannel,
  }),
});
mockModule("../../modules/agents/hooks/use-agent-reachability.js", {
  useAgentReachability: vi.fn(),
});
mockModule("../../modules/agents/hooks/use-auto-wake-on-open.js", {
  useAutoWakeOnOpen: vi.fn(),
});
mockModule("../../modules/agents/hooks/use-harness-config-watch.js", {
  useHarnessConfigWatch: vi.fn(),
});
mockModule("../../modules/agents/hooks/use-public-agent-fallback.js", {
  usePublicAgentFallback: () => false,
});
mockModule("../../modules/agents/hooks/use-slow-start.js", {
  useSlowStartIds: () => new Set<string>(),
});
mockModule("../../modules/a2ui/hooks/use-a2ui-auto-replies.js", {
  useA2uiAutoReplies: vi.fn(),
});
mockModule("../../modules/a2ui/hooks/use-chat-forms-enabled.js", {
  useChatFormsEnabled: () => false,
});
mockModule("../../modules/files/hooks/use-file-tree.js", {
  useFileTree: () => ({ openFileHandler: vi.fn() }),
});
mockModule("../../modules/processes/hooks/use-processes-enabled.js", {
  useProcessesEnabled: () => false,
});
mockModule("../../modules/processes/hooks/use-processes-live-updates.js", {
  useProcessesLiveUpdates: vi.fn(),
});
mockModule("../../modules/changes/hooks/use-changes-available.js", {
  useChangesAvailable: () => false,
});
mockModule("../../modules/changes/hooks/use-toggle-changes.js", {
  useToggleChanges: () => vi.fn(),
});
mockModule("../../modules/browser/hooks/use-auto-open-browser.js", {
  useOpenBrowser: () => vi.fn(),
});
vi.doMock("../../modules/agents/api/queries.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIsAgentOperable: () => fake.operable,
  useIsAgentInaccessible: () => false,
  useAgent: () => ({
    id: "a-1",
    name: "Code Guardian",
    state: fake.state,
    disabled: false,
    overBudget: false,
    features: { liveUpdates: true },
    access: { role: "owner", editors: [], permissions: [] },
    env: [],
    workspaceFailures: [],
    reclaimReason: null,
    startFailure: null,
    podTerminationReason: null,
    podTerminationCode: null,
    hibernationTimeoutMin: 5,
    avatar: null,
    templateUpdate: null,
    unsupportedContributionKinds: [],
  }),
  useAgents: () => ({ data: { list: [], shared: [] } }),
  useAgentRunState: () => fake.state,
  useAgentLacksLiveUpdates: () => false,
  useAgentDisplayName: () => "Code Guardian",
}));
mockModule("../../modules/agents/api/skills.js", {
  useSkillsState: () => ({}),
});
mockModule("../../modules/agents/api/harness-config.js", {
  useHarnessConfigCurrent: () => ({ data: undefined }),
  useHarnessConfigStatus: () => ({ data: undefined, isPending: false }),
});
vi.doMock("../../modules/sessions/api/queries.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAgentSession: () => ({ data: undefined }),
  seedEmptySessionList: vi.fn(),
  keepFirstSessionPages: vi.fn(),
  useAgentsWithUnreadListedSessions: () => new Set<string>(),
}));
mockModule("../../modules/sessions/api/session-pair.js", {
  useProviderConnections: () => ({
    granted: [],
    owned: [],
    loaded: true,
    failed: false,
  }),
  useHarnessCatalogModels: () => ({ data: [] }),
  rememberSessionPair: vi.fn(),
  attachProviderQuietly: vi.fn(),
});
mockModule("../../modules/sessions/api/background-work.js", {
  useSessionBackgroundWork: () => [],
});
mockModule("../../modules/features/api/queries.js", {
  useFeatures: () => ({ data: {} }),
});
mockModule("../../modules/profiles/api/queries.js", {
  useProfiles: () => ({ data: [] }),
});
mockModule("../../modules/telemetry/api/queries.js", {
  useTurns: () => ({ data: undefined }),
});
mockModule("../../modules/spend/api/queries.js", {
  useTurnSpend: () => ({ data: undefined }),
});
mockModule("../../modules/invocations/api/queries.js", {
  useContinuedFrom: () => undefined,
  useDelegationOwners: () => new Map(),
});
mockModule("../../modules/a2ui/api/queries.js", {
  useChatFormPreferences: () => ({ data: undefined }),
});
const anyCall: unknown = new Proxy(function anyCall() {}, {
  get: () => anyCall,
  apply: () => anyCall,
});
mockModule("../../trpc.js", { trpc: anyCall });
mockModule("../../api.js", { api: anyCall });
mockModule("../../query-client.js", {
  queryClient: {
    getQueryData: () => undefined,
    setQueriesData: vi.fn(),
    invalidateQueries: vi.fn(),
    getQueriesData: () => [],
    getQueryCache: () => ({ subscribe: () => () => {} }),
  },
});

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const tooltipProvider = TooltipProvider as unknown as (props: {
  children: ReactNode;
}) => ReactNode;
const { useStore } = await import("../../store.js");
const { ChatView } = await import("../../modules/sessions/views/chat-view.js");

let root: Root | null = null;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

function render(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(tooltipProvider, { children: createElement(ChatView) }),
      ),
    ),
  );
  return el;
}

function openChat(agentState: string, operable: boolean): HTMLElement {
  fake.state = agentState;
  fake.operable = operable;
  useStore.setState({
    selectedAgent: "a-1",
    sessionId: "s-1",
    sessionMode: SessionMode.Chat,
    messages: [],
    drafts: {},
  });
  return render();
}

function paint(): void {
  act(() =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(tooltipProvider, { children: createElement(ChatView) }),
      ),
    ),
  );
}

function pendingPermission(
  toolCallId: string,
  resolve: (outcome: unknown) => boolean,
  channelOpen = true,
): unknown {
  return {
    toolCallId,
    sessionId: "s-1",
    toolCall: { title: `tool ${toolCallId}` },
    isOpen: () => channelOpen,
    options: [
      { optionId: "allow", name: "Allow once", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ],
    resolve,
  };
}

function allowButton(el: HTMLElement): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find(
    (b) => b.textContent === "Allow once",
  );
}

function retryButton(el: HTMLElement): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find(
    (b) => b.textContent === "Retry",
  );
}

function transcriptWithToolCall(): void {
  useStore.setState({
    messages: [
      {
        id: "m-1",
        role: "assistant",
        parts: [{ kind: "tool", toolCallId: "t-1", title: "tool t-1" }],
        streaming: false,
        at: new Date().toISOString(),
      },
    ] as never,
  });
}

const verdictCount = () =>
  (useStore.getState().messages[0]?.parts ?? []).filter(
    (p) => p.kind === "verdict",
  ).length;

const notice = (el: HTMLElement) =>
  el.querySelector("[data-testid='agent-reconnecting-notice']");

const placeholder = (el: HTMLElement) =>
  el.querySelector("textarea")?.getAttribute("placeholder") ?? "";

function button(el: HTMLElement, label: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  fake.busy = false;
  fake.loadingSession = false;
  fake.connectionState = "reconnecting";
  useStore.setState({ pendingPermissions: [] });
  vi.clearAllMocks();
});

// TEST_SCENARIO: the Agent runs and its connection drops; the chat, its composer and the notice stay, and the takeover does not appear.
it("keeps a running Agent's chat while it reconnects", () => {
  const el = openChat("running", false);
  expect(notice(el)).not.toBeNull();
  expect(placeholder(el)).toContain("Reconnecting to this agent");
  expect(el.textContent).not.toContain("Restart agent");
});

// TEST_SCENARIO: the Agent answers again; the notice and the send gate are gone.
it("drops the notice when the Agent answers", () => {
  fake.connectionState = "live";
  const el = openChat("running", true);
  expect(notice(el)).toBeNull();
  expect(placeholder(el)).toBe("Message…");
});

// TEST_SCENARIO: the Agent is asleep, so there is no chat to keep and the takeover with its Start action appears.
it("takes over an Agent with no chat to keep", () => {
  const el = openChat("hibernated", false);
  expect(notice(el)).toBeNull();
  expect(el.textContent).toContain("The agent is sleeping.");
  expect(el.textContent).toContain("Start agent");
});

// TEST_SCENARIO: a send typed during a reconnect stays in the draft and never reaches the Agent, so a Stop can never finalize a bubble whose message still goes out.
it("refuses a send while the Agent reconnects", () => {
  const el = openChat("running", false);
  act(() =>
    useStore.setState({
      drafts: { "a-1:s-1": { text: "hello", attachments: [] } },
    }),
  );
  const send = button(el, "Send");
  expect(send.disabled).toBe(true);
  act(() => send.click());
  expect(fake.sendPrompt).not.toHaveBeenCalled();
  expect(useStore.getState().drafts["a-1:s-1"]?.text).toBe("hello");
});

// TEST_SCENARIO: the control case, the same chat while the Agent answers, sends the message.
it("sends when the Agent answers", () => {
  fake.connectionState = "live";
  const el = openChat("running", true);
  act(() =>
    useStore.setState({
      drafts: { "a-1:s-1": { text: "hello", attachments: [] } },
    }),
  );
  act(() => button(el, "Send").click());
  expect(fake.sendPrompt).toHaveBeenCalledTimes(1);
});

// TEST_SCENARIO: Stop on a reconnecting channel cannot cancel a turn, so it is disabled rather than finalizing a reply that would keep running.
it("refuses a stop while the Agent reconnects", () => {
  fake.busy = true;
  const el = openChat("running", false);
  expect(button(el, "Stop").disabled).toBe(true);
});

// TEST_SCENARIO: the Agent answers but its channel is not live yet, so the chat refuses the actions that need that channel; the gates follow the channel, not whether the Agent is reachable.
it("blocks the chat while the channel is not live", () => {
  const el = openChat("running", true);
  act(() =>
    useStore.setState({
      drafts: { "a-1:s-1": { text: "hello", attachments: [] } },
    }),
  );
  expect(button(el, "Send").disabled).toBe(true);
  fake.busy = true;
  paint();
  expect(button(el, "Stop").disabled).toBe(true);
  expect(notice(el)).not.toBeNull();
  expect(placeholder(el)).toContain("Reconnecting to this agent");
});

// TEST_SCENARIO: a chat opening for the first time waits for its channel to open; that is not a drop, so it reads as connecting, never as reconnecting, while the actions that need the channel stay blocked.
it("waits for a first connection without a reconnect notice", () => {
  fake.connectionState = "idle";
  const el = openChat("running", true);
  act(() =>
    useStore.setState({
      drafts: { "a-1:s-1": { text: "hello", attachments: [] } },
    }),
  );
  expect(notice(el)?.textContent).toContain("Connecting to Code Guardian");
  expect(notice(el)?.textContent).not.toContain("Reconnecting");
  expect(button(el, "Send").disabled).toBe(true);
  expect(placeholder(el)).toContain("Connecting to this agent");
  expect(placeholder(el)).not.toContain("Reconnecting");
});

// TEST_SCENARIO: a channel that never opens would leave the chat blocked with nothing to do, so the notice offers a retry that reopens it.
it("offers a retry when the channel does not open", () => {
  fake.connectionState = "idle";
  const el = openChat("running", true);
  expect(retryButton(el)).toBeDefined();
  act(() => retryButton(el)?.click());
  expect(fake.retryChannel).toHaveBeenCalledTimes(1);
});

// TEST_SCENARIO: an open already in flight owns the channel, so a retry would start a second one; while it runs there is no retry to click.
it("offers no retry while an open is in flight", () => {
  fake.connectionState = "idle";
  fake.loadingSession = true;
  const el = openChat("running", true);
  expect(notice(el)).not.toBeNull();
  expect(retryButton(el)).toBeUndefined();
});

// TEST_SCENARIO: a recovery whose session reload fails leaves the chat on the reloading state with nothing running, so the retry must be there again.
it("offers a retry after a failed reload", () => {
  fake.connectionState = "reloading";
  const el = openChat("running", true);
  expect(retryButton(el)).toBeDefined();
  act(() => retryButton(el)?.click());
  expect(fake.retryChannel).toHaveBeenCalledTimes(1);
});

// TEST_SCENARIO: a new chat of an Agent that cannot be reached holds its prompt until the Agent answers, and a Stop could not cancel it; the chat waits instead, while a reachable Agent's new chat still opens its own channel.
it("blocks a new chat whose Agent is unreachable", () => {
  fake.connectionState = "idle";
  fake.operable = false;
  const el = openChat("running", false);
  act(() => useStore.setState({ sessionId: null }));
  act(() =>
    useStore.setState({
      drafts: { "a-1:~new": { text: "hello", attachments: [] } },
    }),
  );
  paint();
  expect(button(el, "Send").disabled).toBe(true);

  fake.operable = true;
  paint();
  expect(button(el, "Send").disabled).toBe(false);
});

// TEST_SCENARIO: a terminal session does not ride the chat's ACP channel, so a terminal of a running Agent is not blocked and reads no connection state.
it("leaves a terminal session out of the channel gate", () => {
  fake.connectionState = "idle";
  const el = openChat("running", true);
  act(() => useStore.setState({ sessionMode: SessionMode.Terminal }));
  paint();
  expect(notice(el)).toBeNull();
  expect(el.textContent).not.toContain("Connecting to");
  expect(el.textContent).not.toContain("Reconnecting to");
});

// TEST_SCENARIO: a permission answer during a reconnect cannot reach the Agent, so the buttons are disabled and the card says why instead of showing a verdict that did not arrive.
it("refuses a permission answer while the Agent reconnects", () => {
  const resolve = vi.fn(() => true);
  useStore.setState({
    pendingPermissions: [pendingPermission("t-1", resolve)] as never,
  });
  const el = openChat("running", false);
  const allow = allowButton(el);
  expect(allow?.disabled).toBe(true);
  act(() => allow?.click());
  expect(resolve).not.toHaveBeenCalled();
  expect(el.textContent).toContain("answer again once it is back");
});

// TEST_SCENARIO: the channel reloads its session before the runtime reissues the request, so an answer waits for a live channel; the request from the closed channel is dropped when the channel is live, and the reissued one answers.
it("waits for the reissued request before it answers", () => {
  const stale = vi.fn(() => true);
  useStore.setState({
    pendingPermissions: [pendingPermission("t-1", stale, false)] as never,
  });
  fake.connectionState = "reloading";
  const el = openChat("running", true);
  transcriptWithToolCall();

  expect(allowButton(el)?.disabled).toBe(true);
  act(() => allowButton(el)?.click());
  expect(stale).not.toHaveBeenCalled();

  fake.connectionState = "live";
  paint();
  expect(allowButton(el)).toBeUndefined();
  expect(useStore.getState().pendingPermissions).toHaveLength(0);

  const rebound = vi.fn(() => true);
  act(() =>
    useStore.setState({
      pendingPermissions: [pendingPermission("t-1", rebound)] as never,
    }),
  );
  expect(allowButton(el)?.disabled).toBe(false);
  act(() => allowButton(el)?.click());
  expect(rebound).toHaveBeenCalledTimes(1);
  expect(verdictCount()).toBe(1);
  expect(useStore.getState().pendingPermissions).toHaveLength(0);
});

// TEST_SCENARIO: a request ends while this viewer is disconnected, so the runtime never reissues it; the recovered live chat drops the card from the closed channel instead of leaving the composer blocked, and a message can be sent again.
it("drops a request that ended while the channel was down", () => {
  const stale = vi.fn(() => true);
  useStore.setState({
    pendingPermissions: [pendingPermission("t-1", stale, false)] as never,
  });
  fake.connectionState = "reconnecting";
  const el = openChat("running", false);
  expect(allowButton(el)).not.toBeUndefined();
  expect(el.querySelector("textarea")).toBeNull();

  fake.connectionState = "live";
  fake.operable = true;
  paint();

  expect(allowButton(el)).toBeUndefined();
  expect(useStore.getState().pendingPermissions).toHaveLength(0);
  act(() =>
    useStore.setState({
      drafts: { "a-1:s-1": { text: "hello", attachments: [] } },
    }),
  );
  expect(button(el, "Send").disabled).toBe(false);
  act(() => button(el, "Send").click());
  expect(fake.sendPrompt).toHaveBeenCalledTimes(1);
  expect(stale).not.toHaveBeenCalled();
});

// TEST_SCENARIO: the control case, a request the runtime still holds is reissued on the live channel, so the recovery keeps it and it stays answerable.
it("keeps a reissued request through the recovery", () => {
  const reissued = vi.fn(() => true);
  useStore.setState({
    pendingPermissions: [pendingPermission("t-1", reissued)] as never,
  });
  fake.connectionState = "reconnecting";
  const el = openChat("running", false);

  fake.connectionState = "live";
  fake.operable = true;
  paint();

  expect(useStore.getState().pendingPermissions).toHaveLength(1);
  expect(allowButton(el)?.disabled).toBe(false);
  act(() => allowButton(el)?.click());
  expect(reissued).toHaveBeenCalledTimes(1);
});

// TEST_SCENARIO: the control case, the same card on a live channel answers the request and records its verdict.
it("answers a permission on a live channel", () => {
  const resolve = vi.fn(() => true);
  useStore.setState({
    pendingPermissions: [pendingPermission("t-1", resolve)] as never,
  });
  fake.connectionState = "live";
  const el = openChat("running", true);
  transcriptWithToolCall();
  const allow = allowButton(el);
  expect(allow?.disabled).toBe(false);
  act(() => allow?.click());
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(verdictCount()).toBe(1);
  expect(useStore.getState().pendingPermissions).toHaveLength(0);
});

// TEST_SCENARIO: Deny all waits on its confirmation; a disconnect during that wait must stop it, whatever the render it started from, leaving every card pending and no false verdict.
it("stops Deny all at the first answer after a disconnect", async () => {
  const first = vi.fn(() => true);
  const second = vi.fn(() => true);
  useStore.setState({
    pendingPermissions: [
      pendingPermission("t-1", first),
      pendingPermission("t-2", second),
    ] as never,
  });
  let confirm: ((ok: boolean) => void) | undefined;
  useStore.setState({
    showConfirm: () =>
      new Promise<boolean>((res) => {
        confirm = res;
      }),
  } as never);
  fake.connectionState = "live";
  const el = openChat("running", true);
  transcriptWithToolCall();

  const denyAll = [...el.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Deny all"),
  );
  if (!denyAll)
    throw new Error(
      `buttons: ${[...el.querySelectorAll("button")].map((b) => JSON.stringify(b.textContent)).join(", ")}`,
    );
  expect(denyAll.disabled).toBe(false);
  act(() => denyAll.click());

  fake.connectionState = "reconnecting";
  paint();
  await act(async () => confirm?.(true));

  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  expect(useStore.getState().pendingPermissions).toHaveLength(2);
  expect(verdictCount()).toBe(0);
});

// TEST_SCENARIO: the control case, Deny all with the channel still live denies every card it named.
it("denies all on a live channel", async () => {
  const first = vi.fn(() => true);
  const second = vi.fn(() => true);
  useStore.setState({
    pendingPermissions: [
      pendingPermission("t-1", first),
      pendingPermission("t-2", second),
    ] as never,
  });
  useStore.setState({
    showConfirm: async () => true,
  } as never);
  fake.connectionState = "live";
  const el = openChat("running", true);
  transcriptWithToolCall();

  const denyAll = [...el.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Deny all"),
  );
  await act(async () => denyAll?.click());

  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  expect(useStore.getState().pendingPermissions).toHaveLength(0);
});

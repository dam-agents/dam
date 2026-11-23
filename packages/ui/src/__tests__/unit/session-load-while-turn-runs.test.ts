// TEST_OVERVIEW: A Session opened while its turn runs, as the kit update Session the chat opens as soon as it is listed, may fail to load at first although nothing is wrong with it. The chat asks the load again for a short time before it shows an error, and only for a Session the list shows as running. A live message of the shown Session later takes its load error away and reads its history again without the error card.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAcpSession } from "../../modules/sessions/hooks/use-acp-session.js";
import type { Message } from "../../types.js";

const h = vi.hoisted(() => {
  const state = {
    sessionId: null as string | null,
    sessionMode: null,
    messages: [] as Message[],
    queuedPrompts: [] as unknown[],
    sessionError: null as { sessionId: string; kind: string } | null,
    setSessionId: (id: string | null) => (state.sessionId = id),
    setMessages: (m: Message[] | ((prev: Message[]) => Message[])) =>
      (state.messages = typeof m === "function" ? m(state.messages) : m),
    setBusy: () => {},
    setQueuedPrompts: () => {},
    setRewriting: () => {},
    setHarnessForks: () => {},
    setSessionSteering: () => {},
    setRunStarts: () => {},
    setLastOutputAt: () => {},
    setAttribution: () => {},
    setContinuedFrom: () => {},
    setSessionError: (e: typeof state.sessionError) => (state.sessionError = e),
    setSessionMode: () => {},
  };
  return {
    state,
    running: false,
    loadSessionHistory: vi.fn(),
    onLoadErrorCleared: null as ((sid: string) => void) | null,
  };
});

vi.mock("../../store.js", () => ({
  useStore: Object.assign(
    (select: (s: typeof h.state) => unknown) => select(h.state),
    { getState: () => h.state },
  ),
}));
vi.mock("../../query-client.js", () => ({ queryClient: {} }));
vi.mock("../../lib/toast.js", () => ({ emitToast: () => {} }));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useIsAgentOperable: () => false,
  useAgentRunState: () => "running",
  untilAgentOperable: () => new Promise(() => {}),
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  fetchSessionHistory: () => new Promise(() => {}),
  SESSION_HISTORY_TAIL: 200,
  listedSessionRunning: () => h.running,
  setSessionRunning: () => {},
}));
vi.mock("../../modules/sessions/api/acp-session-ops.js", () => ({
  findAgentSession: async () => ({ sessionId: "s1" }),
}));
vi.mock("../../modules/sessions/hooks/use-acp-connection.js", () => ({
  useAcpConnection: () => ({
    loadSessionHistory: h.loadSessionHistory,
    reset: () => {},
    runtimeIdle: () => false,
    clearRuntimeIdle: () => {},
    connectionRef: { current: null },
  }),
}));
vi.mock("../../modules/sessions/hooks/use-acp-prompt.js", () => ({
  useAcpPrompt: () => ({}),
}));
vi.mock("../../modules/sessions/hooks/use-acp-session-engagement.js", () => ({
  useAcpSessionEngagement: () => ({}),
}));
vi.mock("../../modules/sessions/hooks/use-acp-update-handler.js", () => ({
  useAcpUpdateHandler: (
    _onReset: unknown,
    onLoadErrorCleared: (sid: string) => void,
  ) => {
    h.onLoadErrorCleared = onLoadErrorCleared;
    return () => {};
  },
}));

function resumeSession() {
  let resume: ((sid: string) => Promise<void>) | undefined;
  function TestChat() {
    resume = useAcpSession("agent", { current: null }).resumeSession;
    return null;
  }
  renderToStaticMarkup(createElement(TestChat));
  return resume!("s1");
}

const loaded: Message[] = [
  { id: "m1", role: "user", parts: [{ kind: "text", text: "loaded" }] },
] as Message[];

const wouldNotLoad = () => new Error("Internal error");

describe("opening a Session while its turn runs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.state.sessionId = null;
    h.state.messages = [];
    h.state.sessionError = null;
    h.running = true;
    h.loadSessionHistory.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  // TEST_SCENARIO: the kit update Session opens while its first turn runs, and the first load fails. The load is asked again and answers, so the Session opens with its history and no error card.
  it("asks the load again and opens with no error", async () => {
    h.loadSessionHistory
      .mockRejectedValueOnce(wouldNotLoad())
      .mockRejectedValueOnce(wouldNotLoad())
      .mockResolvedValueOnce(loaded);
    const resumed = resumeSession();
    await vi.advanceTimersByTimeAsync(3_000);
    await resumed;
    expect(h.loadSessionHistory).toHaveBeenCalledTimes(3);
    expect(h.state.messages).toBe(loaded);
    expect(h.state.sessionError).toBeNull();
  });

  // TEST_SCENARIO: a running Session that keeps failing to load still gets its error card, after the short retry window and not at once.
  it("shows the error once the retries run out", async () => {
    h.loadSessionHistory.mockRejectedValue(wouldNotLoad());
    const resumed = resumeSession();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(h.state.sessionError).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    await resumed;
    expect(h.loadSessionHistory).toHaveBeenCalledTimes(5);
    expect(h.state.sessionError).toEqual({ sessionId: "s1", kind: "other" });
  });

  // TEST_SCENARIO: a Session the list does not show as running has no turn that could explain the failure, so its error shows at once, as before.
  it("shows the error at once for a Session that does not run", async () => {
    h.running = false;
    h.loadSessionHistory.mockRejectedValue(wouldNotLoad());
    await resumeSession();
    expect(h.loadSessionHistory).toHaveBeenCalledOnce();
    expect(h.state.sessionError).toEqual({ sessionId: "s1", kind: "other" });
  });

  // TEST_SCENARIO: a live message took the load error away. The chat reads the Session's history again, without a spinner, so the messages before the live one show too.
  it("reads the history again when a live message clears the error", async () => {
    h.state.sessionId = "s1";
    h.state.messages = [
      { id: "live", role: "assistant", parts: [{ kind: "text", text: "x" }] },
    ] as Message[];
    h.loadSessionHistory.mockResolvedValue(loaded);
    renderToStaticMarkup(
      createElement(() => {
        useAcpSession("agent", { current: null });
        return null;
      }),
    );
    h.onLoadErrorCleared!("s1");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.loadSessionHistory).toHaveBeenCalledWith("s1");
    expect(h.state.messages).toEqual(loaded);
  });
});

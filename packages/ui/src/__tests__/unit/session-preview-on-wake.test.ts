// TEST_OVERVIEW: A past Session opened on a waking agent asks for its log read as data at the click, so the preview renders as soon as the agent answers, before the chat protocol load answers. A refused read is asked again once the agent is operable. A load that answers first wins, and the preview never replaces it. A load whose connection goes away, as when an api-server replica shuts down, is asked again instead of failing.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAcpSession } from "../../modules/sessions/hooks/use-acp-session.js";
import type { Message } from "../../types.js";

const h = vi.hoisted(() => {
  const deferred = <T>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const state = {
    sessionId: null as string | null,
    sessionMode: null,
    messages: [] as Message[],
    queuedPrompts: [] as unknown[],
    setSessionId: (id: string | null) => (state.sessionId = id),
    setMessages: vi.fn((m: Message[]) => (state.messages = m)),
    setBusy: () => {},
    setQueuedPrompts: () => {},
    setRewriting: () => {},
    setHarnessForks: () => {},
    setSessionSteering: () => {},
    setRunStarts: () => {},
    setLastOutputAt: () => {},
    setAttribution: () => {},
    setContinuedFrom: () => {},
    setSessionError: vi.fn(),
  };
  return {
    deferred,
    state,
    operable: deferred<void>(),
    load: deferred<Message[]>(),
    fetchSessionHistory: vi.fn(),
    loadSessionHistory: vi.fn(),
    goneAway: new Error("connection went away"),
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
  useAgentRunState: () => "hibernated",
  untilAgentOperable: () => h.operable.promise,
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  fetchSessionHistory: h.fetchSessionHistory,
  SESSION_HISTORY_TAIL: 200,
  listedSessionRunning: () => false,
  setSessionRunning: () => {},
}));
vi.mock("../../modules/sessions/api/acp-session-ops.js", () => ({
  findAgentSession: async () => null,
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
vi.mock("../../modules/acp/close-race.js", () => ({
  connectionWentAway: (e: unknown) => e === h.goneAway,
  isConnectionClosed: (e: unknown) => e === h.goneAway,
}));
vi.mock("../../modules/sessions/hooks/use-acp-prompt.js", () => ({
  useAcpPrompt: () => ({}),
}));
vi.mock("../../modules/sessions/hooks/use-acp-session-engagement.js", () => ({
  useAcpSessionEngagement: () => ({}),
}));
vi.mock("../../modules/sessions/hooks/use-acp-update-handler.js", () => ({
  useAcpUpdateHandler: () => () => {},
}));

const frame = (sessionUpdate: string, text: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate, content: { type: "text", text } },
    },
  });

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

describe("opening a past session while the agent wakes", () => {
  beforeEach(() => {
    h.state.sessionId = null;
    h.state.messages = [];
    h.state.setMessages.mockClear();
    h.operable = h.deferred();
    h.load = h.deferred();
    h.loadSessionHistory.mockReset().mockImplementation(() => h.load.promise);
    h.state.setSessionError.mockClear();
    h.fetchSessionHistory
      .mockReset()
      .mockResolvedValue([frame("user_message_chunk", "preview")]);
  });

  // TEST_SCENARIO: the user clicks a Session row while the agent still wakes. The history read goes out at the click, for the relay to hold, and renders as soon as it answers, before the agent reads as operable and before the load answers.
  it("reads the log at the click and previews it when the read answers", async () => {
    const resumed = resumeSession();
    expect(h.fetchSessionHistory).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(h.state.messages[0]?.parts[0]).toMatchObject({ text: "preview" }),
    );

    h.load.resolve(loaded);
    await resumed;
    expect(h.state.messages).toBe(loaded);
  });

  // TEST_SCENARIO: the relay refuses the early read. It is asked again once the agent is operable.
  it("asks again once the agent is operable when the early read fails", async () => {
    h.fetchSessionHistory.mockRejectedValueOnce(new Error("relay refused"));
    const resumed = resumeSession();
    await new Promise((r) => setTimeout(r));
    expect(h.fetchSessionHistory).toHaveBeenCalledOnce();

    h.operable.resolve();
    await vi.waitFor(() =>
      expect(h.state.messages[0]?.parts[0]).toMatchObject({ text: "preview" }),
    );
    expect(h.fetchSessionHistory).toHaveBeenCalledTimes(2);

    h.load.resolve(loaded);
    await resumed;
  });

  // TEST_SCENARIO: the agent fails to start. The early read fails, the wait rejects, and no preview renders.
  it("shows no preview when the agent does not start", async () => {
    h.fetchSessionHistory.mockRejectedValueOnce(new Error("wake failed"));
    const resumed = resumeSession();
    h.operable.reject(new Error("did not start"));
    await new Promise((r) => setTimeout(r));
    expect(h.fetchSessionHistory).toHaveBeenCalledOnce();
    expect(h.state.setMessages).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.anything()]),
    );

    h.load.resolve(loaded);
    await resumed;
  });

  // TEST_SCENARIO: the load answers before the early read. The read's answer is dropped, so it cannot replace or duplicate the loaded messages.
  it("drops the preview when the load answers first", async () => {
    const read = h.deferred<string[]>();
    h.fetchSessionHistory.mockReturnValueOnce(read.promise);
    const resumed = resumeSession();
    h.load.resolve(loaded);
    await resumed;
    read.resolve([frame("user_message_chunk", "preview")]);
    await new Promise((r) => setTimeout(r));
    expect(h.state.messages).toBe(loaded);
  });

  // TEST_SCENARIO: the api-server replica holding the chat protocol socket shuts down during the load and closes it as going away. The load is asked again on a new socket and the session opens, with no error shown.
  it("asks the load again when its connection goes away", async () => {
    vi.useFakeTimers();
    try {
      h.loadSessionHistory.mockRejectedValueOnce(h.goneAway);
      const resumed = resumeSession();
      await vi.advanceTimersByTimeAsync(500);
      expect(h.loadSessionHistory).toHaveBeenCalledTimes(2);
      h.load.resolve(loaded);
      await resumed;
      expect(h.state.messages).toBe(loaded);
      expect(h.state.setSessionError).not.toHaveBeenCalledWith(
        expect.objectContaining({ kind: expect.anything() }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

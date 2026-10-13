// TEST_OVERVIEW: A past Session opened on a waking agent shows its log read as data as soon as the agent is operable, before the chat protocol load answers. A load that answers first wins, and the preview never replaces it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAcpSession } from "../../modules/sessions/hooks/use-acp-session.js";
import type { Message } from "../../types.js";

const h = vi.hoisted(() => {
  const deferred = <T>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };
  const state = {
    sessionId: null as string | null,
    sessionMode: null,
    messages: [] as Message[],
    setSessionId: (id: string | null) => (state.sessionId = id),
    setMessages: vi.fn((m: Message[]) => (state.messages = m)),
    setBusy: () => {},
    setRunStarts: () => {},
    setSessionError: () => {},
  };
  return {
    deferred,
    state,
    operable: deferred<void>(),
    load: deferred<Message[]>(),
    fetchSessionHistory: vi.fn(),
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
  listedSessionRunning: () => false,
  setSessionRunning: () => {},
}));
vi.mock("../../modules/sessions/api/acp-session-ops.js", () => ({
  findAgentSession: async () => null,
}));
vi.mock("../../modules/sessions/hooks/use-acp-connection.js", () => ({
  useAcpConnection: () => ({
    loadSessionHistory: () => h.load.promise,
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
    h.fetchSessionHistory
      .mockReset()
      .mockResolvedValue([frame("user_message_chunk", "preview")]);
  });

  // TEST_SCENARIO: the user clicks a Session row while the agent still wakes. The history read waits for the agent to be operable, then renders before the load answers.
  it("previews the log once the agent becomes operable", async () => {
    const resumed = resumeSession();
    await Promise.resolve();
    expect(h.fetchSessionHistory).not.toHaveBeenCalled();

    h.operable.resolve();
    await vi.waitFor(() =>
      expect(h.state.messages[0]?.parts[0]).toMatchObject({ text: "preview" }),
    );

    h.load.resolve(loaded);
    await resumed;
    expect(h.state.messages).toBe(loaded);
  });

  // TEST_SCENARIO: the load answers before the agent reads as operable. The preview is not read, so it cannot replace or duplicate the loaded messages.
  it("skips the preview when the load answers first", async () => {
    const resumed = resumeSession();
    h.load.resolve(loaded);
    await resumed;
    h.operable.resolve();
    await new Promise((r) => setTimeout(r));
    expect(h.fetchSessionHistory).not.toHaveBeenCalled();
    expect(h.state.messages).toBe(loaded);
  });
});

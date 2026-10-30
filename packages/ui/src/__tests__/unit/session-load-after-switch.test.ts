// @vitest-environment happy-dom
// TEST_OVERVIEW: The chat shows a session as loading only while the session it opened is the one shown. A user who switches to a session and clicks New session before it loaded gets the new-session page at once, and the load that ends after the click, failed or answered, never leaves the spinner behind.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    setMessages: (m: Message[]) => (state.messages = m),
    setBusy: () => {},
    setQueuedPrompts: () => {},
    setRewriting: () => {},
    setHarnessForks: () => {},
    setRunStarts: () => {},
    setLastOutputAt: () => {},
    setAttribution: () => {},
    setContinuedFrom: () => {},
    setSessionError: () => {},
    setSessionMode: () => {},
  };
  return {
    deferred,
    state,
    loads: new Map<string, ReturnType<typeof deferred<Message[]>>>(),
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
  useIsAgentOperable: () => true,
  useAgentRunState: () => "running",
  untilAgentOperable: () => Promise.resolve(),
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  fetchSessionHistory: () => new Promise(() => {}),
  SESSION_HISTORY_TAIL: 200,
  listedSessionRunning: () => false,
  setSessionRunning: () => {},
}));
vi.mock("../../modules/sessions/api/acp-session-ops.js", () => ({
  findAgentSession: async () => null,
}));
vi.mock("../../modules/sessions/hooks/use-acp-connection.js", () => ({
  useAcpConnection: () => ({
    loadSessionHistory: (sid: string) => {
      const load = h.deferred<Message[]>();
      h.loads.set(sid, load);
      return load.promise;
    },
    reset: () => {},
    runtimeIdle: () => false,
    clearRuntimeIdle: () => {},
    connectionRef: { current: null },
  }),
}));
vi.mock("../../modules/acp/close-race.js", () => ({
  connectionWentAway: () => false,
  isConnectionClosed: () => false,
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

let root: Root;
let chat: ReturnType<typeof useAcpSession>;

function TestChat() {
  chat = useAcpSession("agent", { current: null });
  return null;
}

const render = () => act(() => root.render(createElement(TestChat)));

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r));
  });
}

const loaded: Message[] = [
  { id: "m1", role: "user", parts: [{ kind: "text", text: "loaded" }] },
] as Message[];

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  h.state.sessionId = null;
  h.state.messages = [];
  h.loads.clear();
  root = createRoot(document.createElement("div"));
  render();
});

afterEach(() => act(() => root.unmount()));

describe("the loading state after a switch between sessions", () => {
  // TEST_SCENARIO: the user switches to a session and clicks New session while it still loads. The new-session page shows at once, and the load, which fails when its connection is closed, does not bring the spinner back.
  it("ends when New session is clicked while the session loads", async () => {
    let resumed!: Promise<void>;
    act(() => {
      resumed = chat.resumeSession("s1");
    });
    render();
    expect(chat.loadingSession).toBe(true);

    act(() => chat.resetSession());
    render();
    expect(chat.loadingSession).toBe(false);

    h.loads.get("s1")!.reject(new Error("connection closed"));
    await resumed;
    await settle();
    render();
    expect(chat.loadingSession).toBe(false);

    act(() => {
      void chat.resumeSession("s2");
    });
    render();
    expect(chat.loadingSession).toBe(true);
  });

  // TEST_SCENARIO: the user opens one session and switches to a second before the first loaded. The first load ending does not end the second's loading state; the second's own answer does.
  it("stays on for the second session when the first load ends", async () => {
    act(() => {
      void chat.resumeSession("s1");
    });
    let second!: Promise<void>;
    act(() => {
      second = chat.resumeSession("s2");
    });
    render();

    h.loads.get("s1")!.resolve(loaded);
    await settle();
    render();
    expect(chat.loadingSession).toBe(true);

    h.loads.get("s2")!.resolve(loaded);
    await second;
    await settle();
    render();
    expect(chat.loadingSession).toBe(false);
    expect(h.state.messages).toBe(loaded);
  });
});

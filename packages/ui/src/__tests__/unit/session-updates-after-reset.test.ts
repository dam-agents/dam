// @vitest-environment happy-dom
// TEST_OVERVIEW: New session clears the transcript even when the old socket drains a queued notification after close; the active connection's updates still reach its chat.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useAcpConnection } from "../../modules/sessions/hooks/use-acp-connection.js";
import { createPromptDelivery } from "../../modules/sessions/lib/prompt-delivery.js";

const h = vi.hoisted(() => ({
  update: null as null | ((update: unknown, sessionId: string) => void),
  messages: [] as string[],
  opening: null as Promise<void> | null,
  sockets: [] as { readyState: number }[],
  state: {
    sessionId: null as string | null,
    drafts: {},
    migrateDraft: () => {},
    setContinuedFrom: () => {},
    setHarnessForks: () => {},
    setSessionSteering: () => {},
    setSessionId: (id: string) => {
      h.state.sessionId = id;
    },
  },
}));
vi.mock("../../store.js", () => ({ useStore: { getState: () => h.state } }));
vi.mock("../../query-client.js", () => ({
  queryClient: { invalidateQueries: async () => {} },
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  seedStartedSession: () => {},
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  settledNextSessionPair: async () => null,
}));
vi.mock("../../modules/acp/acp.js", () => ({
  sessionForksIn: () => false,
  sessionSteeringIn: () => null,
  openInitializedConnection: async (
    _agent: string,
    update: typeof h.update,
  ) => {
    h.update = update;
    const ws = Object.assign(new EventTarget(), {
      readyState: 1,
      close() {
        this.readyState = 3;
      },
    });
    h.sockets.push(ws);
    if (h.opening) await h.opening;
    return {
      connection: {
        agent: { request: async () => ({ sessionId: "old-session" }) },
      },
      ws,
      forksSessions: false,
    };
  },
}));

const clearEngagement = () => {};
let root: Root;
let chat: ReturnType<typeof useAcpConnection>;
function Chat() {
  chat = useAcpConnection({
    selectedAgent: "agent",
    sessionId: null,
    sessionMode: null,
    liveBlocked: true,
    agentOperable: false,
    makeUpdateHandler: () => () => {
      h.messages.push("old queued message");
    },
    engage: async () => null,
    bindEngagement: () => {},
    clearEngagement,
    setMessages: () => {},
    delivery: createPromptDelivery(),
  });
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.update = null;
  h.opening = null;
  h.sockets = [];
  h.messages = [];
  h.state.sessionId = null;
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => {
    root.render(createElement(Chat));
  });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

// TEST_SCENARIO: the first session's socket is retained, New session closes it, and an already-buffered update drains afterwards. It must not repopulate the new chat.
it("ignores a retained session's queued updates after New session", async () => {
  await act(async () => {
    const started = await chat.beginSession();
    started.settle(true);
  });
  h.update!(
    {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "queued" },
    },
    "old-session",
  );
  expect(h.messages).toEqual(["old queued message"]);
  act(() => {
    chat.reset();
    h.state.sessionId = null;
    h.messages = [];
  });
  h.update!(
    {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "queued" },
    },
    "old-session",
  );
  expect(h.messages).toEqual([]);
});

// TEST_SCENARIO: New session occurs while a history connection is opening. The stale socket closes rather than replacing the next chat's live connection.
it("closes a history connection that finishes opening after reset", async () => {
  let opened!: () => void;
  h.opening = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const loading = chat
    .loadSessionHistory("old-session")
    .catch((error: unknown) => error);
  await vi.waitFor(() => expect(h.sockets).toHaveLength(1));
  act(() => chat.reset());
  let outcome: unknown;
  await act(async () => {
    opened();
    outcome = await loading;
  });
  expect(chat.connectionRef.current).toBeNull();
  expect(h.sockets[0]?.readyState).toBe(3);
  expect(outcome).toBeInstanceOf(Error);
});

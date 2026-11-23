// @vitest-environment happy-dom
// TEST_OVERVIEW: After a live message took a load error away, the chat reads the Session's history again on a fresh channel. The runtime keeps a replay cursor per channel, so the channel that already carried live output would replay only unread frames; a fresh channel starts from the newest tail of the Session Transcript and carries the live messages with it. The read shows no reconnecting state, and a read that fails again keeps the chat live with the messages it has.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useAcpConnection } from "../../modules/sessions/hooks/use-acp-connection.js";
import { createPromptDelivery } from "../../modules/sessions/lib/prompt-delivery.js";
import type { Message } from "../../types.js";

type Update = (
  update: unknown,
  sessionId: string,
  frame?: { replayFor?: string },
) => void;

interface FakeSocket extends EventTarget {
  readyState: number;
  close: () => void;
}

const h = vi.hoisted(() => ({
  sockets: [] as { socket: FakeSocket; update: Update }[],
  loads: [] as { socket: number; tail: boolean }[],
  failLoad: false,
  state: {
    sessionId: "s1" as string | null,
    selectedAgent: "agent",
    runStarts: [] as string[],
    lastOutputAt: null,
    setRunStarts: () => {},
    setQueuedPrompts: () => {},
    setLastOutputAt: () => {},
    setReportedCommands: () => {},
    setAttribution: () => {},
    setContinuedFrom: () => {},
    setHarnessForks: () => {},
    setSessionSteering: () => {},
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
  openInitializedConnection: async (_agent: string, update: Update) => {
    const socket = Object.assign(new EventTarget(), {
      readyState: 1,
      close() {
        this.readyState = 3;
        this.dispatchEvent(new Event("close"));
      },
    });
    const index = h.sockets.length;
    h.sockets.push({ socket, update });
    return {
      connection: {
        agent: {
          request: async (
            method: string,
            params: {
              _meta: { platform: { tail?: boolean; loadToken: string } };
            },
          ) => {
            if (method !== "session/load") return {};
            const { tail, loadToken } = params._meta.platform;
            h.loads.push({ socket: index, tail: tail === true });
            if (h.failLoad) throw new Error("Internal error");
            for (const text of ["first prompt", "live reply"])
              update(
                {
                  sessionUpdate:
                    text === "first prompt"
                      ? "user_message_chunk"
                      : "agent_message_chunk",
                  content: { type: "text", text },
                },
                "s1",
                { replayFor: loadToken },
              );
            return {};
          },
        },
      },
      ws: socket,
      forksSessions: false,
    };
  },
}));

let root: Root;
let chat: ReturnType<typeof useAcpConnection>;
let shown: Message[];
const engage = vi.fn(async () => "s1");

const makeUpdateHandler = () => () => {};
const bindEngagement = () => {};
const clearEngagement = () => {};
const setMessages = (m: Message[] | ((prev: Message[]) => Message[])) => {
  shown = typeof m === "function" ? m(shown) : m;
};
const delivery = createPromptDelivery();

function Chat() {
  chat = useAcpConnection({
    selectedAgent: "agent",
    sessionId: "s1",
    sessionMode: null,
    liveBlocked: true,
    agentOperable: false,
    makeUpdateHandler,
    engage,
    bindEngagement,
    clearEngagement,
    setMessages,
    delivery,
  });
  return null;
}

const texts = () =>
  shown.flatMap((m) => m.parts.map((p) => ("text" in p ? p.text : "")));

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.sockets = [];
  h.loads = [];
  h.failLoad = false;
  engage.mockClear();
  shown = [];
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(createElement(Chat));
  });
  await act(async () => {
    await chat.ensureLive();
  });
  shown = [
    {
      id: "live",
      role: "assistant",
      parts: [{ kind: "text", text: "live reply" }],
    },
  ] as Message[];
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

// TEST_SCENARIO: the chat shows only the live reply that cleared the error. The history is read on a second socket from the Session's tail, the first socket closes, and the chat then shows the first prompt above the reply, with no reconnecting state on the way.
it("reads the whole tail on a fresh channel", async () => {
  const states: string[] = [];
  await act(async () => {
    chat.reloadOnFreshChannel();
    states.push(chat.state);
  });
  await vi.waitFor(() => expect(engage).toHaveBeenCalledTimes(2));
  expect(h.sockets).toHaveLength(2);
  expect(h.sockets[0]!.socket.readyState).toBe(3);
  expect(h.loads).toEqual([{ socket: 1, tail: true }]);
  expect(texts()).toEqual(["first prompt", "live reply"]);
  expect([...states, chat.state]).not.toContain("reloading");
  expect(chat.state).toBe("live");
});

// TEST_SCENARIO: the history still does not load on the fresh channel. The chat engages the Session without it, so live messages keep arriving, and the messages on screen stay.
it("stays live with its messages when the read fails again", async () => {
  h.failLoad = true;
  await act(async () => {
    chat.reloadOnFreshChannel();
  });
  await vi.waitFor(() => expect(engage).toHaveBeenCalledTimes(2));
  expect(h.loads).toEqual([{ socket: 1, tail: true }]);
  expect(texts()).toEqual(["live reply"]);
  expect(chat.state).toBe("live");
});

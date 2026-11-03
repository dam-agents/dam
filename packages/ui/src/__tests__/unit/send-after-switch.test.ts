// @vitest-environment happy-dom
// TEST_OVERVIEW: a message sent in a session reaches the agent even when the person opens another session before it went out. The chat's own connection follows the chat to the new session, so the send goes over a connection of its own, engaged to the session it was typed in, and the move never turns it into a "Not delivered" mark. A send whose chat stayed on its session still uses the chat's connection, and one the chat could not carry still fails where the person sees it.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AsideSession,
  LiveSession,
} from "../../modules/sessions/hooks/use-acp-connection.js";
import { useAcpPrompt } from "../../modules/sessions/hooks/use-acp-prompt.js";
import { createPromptDelivery } from "../../modules/sessions/lib/prompt-delivery.js";
import type { Message } from "../../types.js";

const h = vi.hoisted(() => {
  const state = {
    selectedAgent: "agent" as string | null,
    sessionId: "s1" as string | null,
    sessionMode: null,
    messages: [] as Message[],
    queuedPrompts: [] as unknown[],
    setMessages: (next: Message[] | ((prev: Message[]) => Message[])) => {
      state.messages =
        typeof next === "function" ? next(state.messages) : next;
    },
  };
  return { state };
});

vi.mock("../../store.js", () => ({
  useStore: Object.assign(
    (select: (s: typeof h.state) => unknown) => select(h.state),
    { getState: () => h.state },
  ),
}));
vi.mock("../../query-client.js", () => ({
  queryClient: { invalidateQueries: () => Promise.resolve() },
}));
vi.mock("../../trpc.js", () => ({
  trpc: {
    providerStatus: { list: { queryKey: () => ["providerStatus"] } },
    connections: {
      getAgentConnections: { queryKey: () => ["connections"] },
    },
  },
}));
vi.mock("../../lib/toast.js", () => ({ emitToast: () => {} }));
vi.mock("../../modules/agents/api/queries.js", () => ({
  untilAgentOperable: () => null,
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  optimisticInsertSession: () => {},
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  harnessOfSession: () => undefined,
}));
vi.mock("../../modules/acp/utils.js", () => ({
  buildPromptBlocks: async (_a: string, _s: string, text: string) => [
    { type: "text", text },
  ],
}));

interface FakeConnection {
  sent: { method: string; params: unknown }[];
  connection: LiveSession["connection"];
}

function fakeConnection(): FakeConnection {
  const sent: FakeConnection["sent"] = [];
  const connection = {
    agent: {
      request: (method: string, params: unknown) => {
        sent.push({ method, params });
        return new Promise(() => {});
      },
    },
  } as unknown as LiveSession["connection"];
  return { sent, connection };
}

let root: Root;
let send: ReturnType<typeof useAcpPrompt>["sendPrompt"];
let ensureConnection: () => Promise<LiveSession | null>;
let engageAside: (sessionId: string) => Promise<AsideSession>;

function TestChat() {
  ({ sendPrompt: send } = useAcpPrompt({
    selectedAgent: "agent",
    agentRunState: "running",
    ensureConnection: () => ensureConnection(),
    engageAside: (sid) => engageAside(sid),
    beginSession: () => Promise.reject(new Error("no new session here")),
    engagedSessionIdRef: { current: null },
    connectionRef: { current: null },
    textareaRef: { current: null },
    delivery: createPromptDelivery(),
  }));
  return null;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
  });
}

function promptsOn(conn: FakeConnection): unknown[] {
  return conn.sent.filter((f) => f.method === "session/prompt");
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  h.state.selectedAgent = "agent";
  h.state.sessionId = "s1";
  h.state.messages = [];
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(TestChat)));
});

afterEach(() => act(() => root.unmount()));

describe("a send whose chat moves to another session", () => {
  // TEST_SCENARIO: the person sends in s1 and opens s2 while the chat's connection is still coming up. The chat's connection now belongs to s2, so the message goes over a connection engaged to s1, closed once the send is done, and nothing in the s2 chat is marked undelivered.
  it("goes to its own session over a connection of its own", async () => {
    let chatReady!: (live: LiveSession | null) => void;
    ensureConnection = () =>
      new Promise((resolve) => {
        chatReady = resolve;
      });
    const aside = fakeConnection();
    const close = vi.fn();
    const engaged: string[] = [];
    engageAside = async (sid) => {
      engaged.push(sid);
      return {
        connection: aside.connection,
        sessionId: sid,
        isOpen: () => true,
        close,
      };
    };

    void send("run the migration");
    await settle();
    h.state.sessionId = "s2";
    h.state.messages = [];
    const chat = fakeConnection();
    chatReady({
      connection: chat.connection,
      sessionId: "s2",
      isOpen: () => true,
    });
    await settle();

    expect(engaged).toEqual(["s1"]);
    expect(promptsOn(aside)).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ sessionId: "s1" }),
      }),
    ]);
    expect(promptsOn(chat)).toEqual([]);
    expect(h.state.messages.some((m) => m.error)).toBe(false);
  });

  // TEST_SCENARIO: the chat stays on s1, so the send uses the chat's own connection and opens nothing else.
  it("uses the chat's connection while the chat stays on its session", async () => {
    const chat = fakeConnection();
    ensureConnection = async () => ({
      connection: chat.connection,
      sessionId: "s1",
      isOpen: () => true,
    });
    engageAside = vi.fn();

    void send("run the migration");
    await settle();

    expect(promptsOn(chat)).toHaveLength(1);
    expect(engageAside).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the chat stays on s1 and its connection cannot be made. The person is still looking at the message, so it fails there with the reason.
  it("fails where the person sees it when the chat could not carry it", async () => {
    ensureConnection = async () => null;
    engageAside = vi.fn();

    void send("run the migration");
    await settle();

    const failed = h.state.messages.find((m) => m.role === "user");
    expect(failed?.error?.message).toBe("Failed to establish connection");
    expect(engageAside).not.toHaveBeenCalled();
  });
});

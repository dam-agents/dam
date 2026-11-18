// TEST_OVERVIEW: The session list of an Agent that does not report live updates is read over the passive ACP connection through the api-server's agent relay. A list that polls every five seconds must not pay for a WebSocket handshake, an ACP initialize and an upstream connect on every read, so the reads of one Agent share one passive connection, opened on the first read and closed once the list has been idle. An Agent that reports live updates keeps reading its list over the runtime's tRPC relay and never opens this connection.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const sockets: {
    agentId: string;
    readyState: number;
    closed: boolean;
    closeListeners: (() => void)[];
  }[] = [];
  const requests: { agentId: string; method: string }[] = [];
  const lacking = new Set<string>();
  return { sockets, requests, lacking };
});

vi.mock("../../modules/acp/acp.js", () => ({
  openInitializedConnection: async (agentId: string) => {
    const socket = {
      agentId,
      readyState: 1,
      closed: false,
      closeListeners: [] as (() => void)[],
    };
    h.sockets.push(socket);
    const ws = {
      get readyState() {
        return socket.readyState;
      },
      close: () => {
        socket.closed = true;
        socket.readyState = 3;
      },
      addEventListener: (event: string, listener: () => void) => {
        if (event === "close") socket.closeListeners.push(listener);
      },
    };
    const connection = {
      agent: {
        request: async (method: string) => {
          h.requests.push({ agentId, method });
          return { sessions: [] };
        },
      },
    };
    return { connection, ws, forksSessions: false };
  },
}));

vi.mock("../../modules/agents/api/queries.js", () => ({
  agentLacksLiveUpdates: (agentId: string) => h.lacking.has(agentId),
}));

vi.mock("../../modules/agents/agent-trpc.js", () => ({
  agentTrpc: () => ({
    sessions: {
      list: { query: async () => ({ sessions: [] }) },
      history: { query: async () => ({ frames: [] }) },
    },
  }),
}));

const { listAgentSessionPage } =
  await import("../../modules/sessions/api/acp-session-ops.js");

const PASSIVE_IDLE_MS = 30_000;

beforeEach(() => {
  h.sockets.length = 0;
  h.requests.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the passive session-list read", () => {
  /**
   * TEST_SCENARIO: An Agent without live updates polls its list every five
   * seconds. Two reads in a row must share one connection, so the poll costs
   * a `session/list` frame rather than a handshake.
   */
  it("should read two refreshes over one connection", async () => {
    h.lacking.add("polling-agent");
    await listAgentSessionPage("polling-agent");
    await listAgentSessionPage("polling-agent");

    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0]?.closed).toBe(false);
    expect(
      h.requests.filter((r) => r.agentId === "polling-agent"),
    ).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: A connection the relay dropped is useless. The next read
   * must open a fresh one instead of sending `session/list` into a closed
   * socket, where the answer would never come.
   */
  it("should replace a connection the relay dropped", async () => {
    h.lacking.add("dropped-agent");
    await listAgentSessionPage("dropped-agent");
    const first = h.sockets[0];
    if (!first) throw new Error("no connection opened");
    first.readyState = 3;
    for (const listener of first.closeListeners) listener();

    await listAgentSessionPage("dropped-agent");

    expect(h.sockets).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: A closed list leaves nothing behind. Once the list has
   * been idle for the reuse window, the connection closes, and a later read
   * opens a new one.
   */
  it("should close an idle connection and reopen on the next read", async () => {
    vi.useFakeTimers();
    h.lacking.add("idle-agent");
    await listAgentSessionPage("idle-agent");
    expect(h.sockets[0]?.closed).toBe(false);

    await vi.advanceTimersByTimeAsync(PASSIVE_IDLE_MS);
    expect(h.sockets[0]?.closed).toBe(true);

    await listAgentSessionPage("idle-agent");
    expect(h.sockets).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: An Agent that reports live updates reads its list over the
   * runtime's tRPC relay. It must never open the passive ACP connection.
   */
  it("should not open a connection for an agent that reports live updates", async () => {
    await listAgentSessionPage("live-agent");

    expect(h.sockets).toHaveLength(0);
  });
});

import { expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as
    null | ((update: unknown, sid: string, frame: unknown) => void),
  state: {
    runStarts: [] as string[],
    setSessionModel: () => {},
    setRunStarts: () => {},
  },
  queue: [
    {
      promptId: "waiting-1",
      blocks: [{ type: "text", text: "waiting behind the turn" }],
      queuedAt: "2026-10-27T00:00:00Z",
      editable: true,
    },
  ],
}));
vi.mock("react", () => ({
  useCallback: (f: unknown) => f,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, () => {}],
}));
vi.mock("../../store.js", () => ({ useStore: { getState: () => h.state } }));
vi.mock("../../modules/acp/utils.js", () => ({ RECONNECT_DELAYS: [0] }));
vi.mock("../../modules/sessions/api/acp-session-ops.js", () => ({
  findAgentSession: async () => null,
  handOverUndelivered: async () => {},
}));
vi.mock("../../modules/sessions/lib/undelivered-store.js", () => ({
  clearUndelivered: () => {},
  readUndelivered: () => [],
}));
vi.mock("../../modules/sessions/lib/prompt-delivery.js", () => ({
  withDeliveryTracking: (_d: unknown, handler: unknown) => handler,
}));
vi.mock("../../modules/acp/acp.js", () => ({
  openInitializedConnection: async (
    _agent: string,
    handler: typeof h.handler,
  ) => {
    h.handler = handler;
    return {
      ws: { addEventListener: () => {} },
      connection: {
        agent: {
          request: async () => ({
            _meta: { platform: { turn: { inFlight: true }, queue: h.queue } },
          }),
        },
      },
    };
  },
}));

import { useAcpConnection } from "../../modules/sessions/hooks/use-acp-connection.js";

// TEST_SCENARIO: A tab that reloads while a prompt waits behind a running turn gets the runtime queue back with the history, so the waiting prompt shows as waiting instead of disappearing.
test("a reloaded history restores the runtime queue", async () => {
  const conn = useAcpConnection({
    selectedAgent: "a",
    sessionId: "s",
    sessionMode: null,
    liveBlocked: false,
    agentOperable: true,
    makeUpdateHandler: () => () => {},
    engage: async () => "s",
    bindEngagement: () => {},
    clearEngagement: () => {},
    setMessages: () => {},
    delivery: {} as never,
  });
  const replay = await conn.loadSessionHistory("s");
  const waiting = replay.filter((m) => m.queued === true);
  expect(waiting).toHaveLength(1);
  expect(waiting[0]!.promptId).toBe("waiting-1");
  const bubble = replay.find((m) => m.role === "user" && m.id === "waiting-1");
  expect(bubble).toBeDefined();
});

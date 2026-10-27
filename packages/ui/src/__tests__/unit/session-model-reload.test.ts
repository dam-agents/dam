import { expect, test, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    sessionId: "s",
    runStarts: [] as string[],
    sessionModel: null as unknown,
    setSessionModel: (model: unknown) => {
      state.sessionModel = model;
    },
    setRunStarts: () => {},
  };
  return { state };
});
vi.mock("react", () => ({
  useCallback: (f: unknown) => f,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, () => {}],
}));
vi.mock("../../store.js", () => ({ useStore: { getState: () => h.state } }));
vi.mock("../../modules/acp/utils.js", () => ({ RECONNECT_DELAYS: [0] }));
vi.mock("../../modules/sessions/api/acp-session-ops.js", () => ({
  findAgentSession: async () => ({
    sessionId: "s",
    model: "ibm/aws/claude-sonnet-5-5",
  }),
  handOverUndelivered: async () => {},
}));
vi.mock("../../modules/sessions/lib/undelivered-store.js", () => ({
  clearUndelivered: () => {},
  readUndelivered: () => [],
}));
vi.mock("../../modules/sessions/lib/prompt-delivery.js", () => ({
  withDeliveryTracking: (_delivery: unknown, handler: unknown) => handler,
}));
vi.mock("../../modules/acp/acp.js", () => ({
  openInitializedConnection: async () => ({
    ws: { addEventListener: () => {} },
    connection: {
      agent: {
        request: async () => ({
          configOptions: [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "claude/ibm/aws/claude-opus-5-5",
              options: [
                { value: "claude/ibm/aws/claude-opus-5-5", name: "Opus 5.5" },
                {
                  value: "claude/ibm/aws/claude-sonnet-5-5",
                  name: "Sonnet 5.5",
                },
              ],
            },
          ],
        }),
      },
    },
  }),
}));

import { useAcpConnection } from "../../modules/sessions/hooks/use-acp-connection.js";

// TEST_SCENARIO: after a reload the harness answers session/load with its own default model, while the lease router keeps the model the session was pinned to and runs every turn on it. The chip must show the pinned model, matched to the harness's option, not the harness's default.
test("a reloaded session shows the model it is pinned to", async () => {
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
  await conn.loadSessionHistory("s");
  expect(h.state.sessionModel).toMatchObject({
    sessionId: "s",
    current: "claude/ibm/aws/claude-sonnet-5-5",
  });
});

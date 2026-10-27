import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    sessionId: null as string | null,
    sessionModel: null as unknown,
    setSessionModel: (model: unknown) => {
      state.sessionModel = model;
    },
  };
  return {
    state,
    configOptions: null as unknown,
    listed: Promise.resolve<{ model?: string } | null>(null),
  };
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
  findAgentSession: () => h.listed,
  handOverUndelivered: async () => {},
}));
vi.mock("../../modules/sessions/lib/prompt-delivery.js", () => ({
  withDeliveryTracking: (_delivery: unknown, handler: unknown) => handler,
}));
vi.mock("../../modules/acp/acp.js", () => ({
  openInitializedConnection: async () => ({
    ws: { addEventListener: () => {}, close: () => {} },
    connection: {
      agent: {
        request: async () => ({
          sessionId: "s-new",
          configOptions: h.configOptions,
        }),
      },
    },
  }),
}));

import { useAcpConnection } from "../../modules/sessions/hooks/use-acp-connection.js";

const codexOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "ibm/aws/gpt-6.1-sol",
    options: [
      { value: "ibm/aws/gpt-6.1-sol", name: "ibm/aws/gpt-6.1-sol" },
      { value: "ibm/aws/claude-opus-5-5", name: "ibm/aws/claude-opus-5-5" },
    ],
  },
];

function begin() {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- the mocked React hooks run outside a component
  return useAcpConnection({
    selectedAgent: "a",
    sessionId: null,
    sessionMode: null,
    liveBlocked: false,
    agentOperable: true,
    makeUpdateHandler: () => () => {},
    engage: async () => "s-new",
    bindEngagement: () => {},
    clearEngagement: () => {},
    setMessages: () => {},
    delivery: {} as never,
  }).beginSession();
}

beforeEach(() => {
  h.state.sessionId = null;
  h.state.sessionModel = null;
  h.configOptions = codexOptions;
  h.listed = Promise.resolve({ model: "ibm/aws/claude-opus-5-5" });
});

// TEST_SCENARIO: Codex answers session/new with the first model the router lists as its own default, while the lease router runs the session on the agent's default model and sets it in the harness after session/new. The chip of the new live session must show the model the router runs, as it does after a reload, not the harness's first listed model.
it("shows the model the router runs a new session on", async () => {
  await begin();
  await vi.waitFor(() =>
    expect(h.state.sessionModel).toMatchObject({
      sessionId: "s-new",
      current: "ibm/aws/claude-opus-5-5",
    }),
  );
});

// TEST_SCENARIO: the router's record arrives after session/new; a model the user picked meanwhile is newer and stays.
it("does not override a pick made before the router's record arrived", async () => {
  let answer!: (value: { model: string }) => void;
  h.listed = new Promise((resolve) => (answer = resolve));
  await begin();
  const picked = { sessionId: "s-new", current: "ibm/aws/gpt-6.1-sol" };
  h.state.sessionModel = picked;
  answer({ model: "ibm/aws/claude-opus-5-5" });
  await h.listed;
  await Promise.resolve();
  expect(h.state.sessionModel).toBe(picked);
});

// TEST_SCENARIO: a harness that reports no model option leaves the chip empty, and a person may open another new chat before the router's record arrives. The late record names the session it was asked for, so it must not land in whatever chat is shown by then.
it("sets nothing when the harness reported no model", async () => {
  h.configOptions = null;
  await begin();
  await h.listed;
  await Promise.resolve();
  expect(h.state.sessionModel).toBeNull();
});

import { beforeEach, expect, it, vi } from "vitest";

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
      agent: { request: async () => ({ configOptions: h.configOptions }) },
    },
  }),
}));

import { useAcpConnection } from "../../modules/sessions/hooks/use-acp-connection.js";
import { withRoutedCurrent } from "../../modules/sessions/lib/session-model.js";

const claudeOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "claude/ibm/aws/claude-opus-5-5",
    options: [
      { value: "claude/ibm/aws/claude-opus-5-5", name: "Opus 5.5" },
      { value: "claude/ibm/aws/claude-sonnet-5-5", name: "Sonnet 5.5" },
    ],
  },
];

const pinned = { sessionId: "s", model: "ibm/aws/claude-sonnet-5-5" };

function load() {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- the mocked React hooks run outside a component
  return useAcpConnection({
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
  }).loadSessionHistory("s");
}

beforeEach(() => {
  h.state.sessionModel = null;
  h.configOptions = claudeOptions;
  h.listed = Promise.resolve(pinned);
});

// TEST_SCENARIO: after a reload the harness answers session/load with its own default model, while the lease router keeps the model the session was pinned to and runs every turn on it. The chip must show the pinned model, matched to the harness's option, not the harness's default.
it("shows the model a reloaded session is pinned to", async () => {
  await load();
  await vi.waitFor(() =>
    expect(h.state.sessionModel).toMatchObject({
      sessionId: "s",
      current: "claude/ibm/aws/claude-sonnet-5-5",
    }),
  );
});

// TEST_SCENARIO: a cold load served from the session-history provider carries no config options, so only the router's record names the model; the chip shows it instead of the agent's default.
it("shows the pinned model when a cold load carries no options", async () => {
  h.configOptions = null;
  await load();
  await vi.waitFor(() =>
    expect(h.state.sessionModel).toEqual({
      sessionId: "s",
      configId: "model",
      current: "ibm/aws/claude-sonnet-5-5",
      choices: [],
    }),
  );
});

// TEST_SCENARIO: the router's record is read beside session/load and never delays the replayed history. A pick the user made while it was on its way wins over the older record.
it("does not wait for the router's record, nor override a later pick", async () => {
  let answer!: (value: typeof pinned) => void;
  h.listed = new Promise((resolve) => (answer = resolve));
  await load();
  expect(h.state.sessionModel).toMatchObject({
    current: "claude/ibm/aws/claude-opus-5-5",
  });
  const picked = { sessionId: "s", current: "claude/ibm/aws/claude-opus-5-5" };
  h.state.sessionModel = picked;
  answer(pinned);
  await h.listed;
  await Promise.resolve();
  expect(h.state.sessionModel).toBe(picked);
});

// TEST_SCENARIO: a Claude process on a native Bedrock Connection lists Claude's own tier names, while the router records the session's model qualified with the Connection's alias. The chip matches the bare tier to the qualified record; a qualified option never matches by its tier alone.
it("matches a native tier to the router's qualified record", () => {
  const native = {
    sessionId: "s",
    configId: "model",
    current: "opus",
    choices: [
      { value: "opus", name: "Opus" },
      { value: "sonnet", name: "Sonnet" },
    ],
  };
  expect(withRoutedCurrent(native, "bedrock/sonnet").current).toBe("sonnet");
  const routed = {
    ...native,
    current: "claude/ibm/opus",
    choices: [{ value: "claude/ibm/opus", name: "Opus" }],
  };
  expect(withRoutedCurrent(routed, "bedrock/sonnet")).toBe(routed);
});

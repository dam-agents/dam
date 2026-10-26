import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  remember: vi.fn(async () => {}),
  set: vi.fn(async () => {}),
}));
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
}));
vi.mock("../../query-client.js", () => ({
  queryClient: {
    getQueryData: (key: string) => h.cache.get(key),
    invalidateQueries: async () => {},
    cancelQueries: async () => {},
    setQueryData: () => {},
  },
}));
vi.mock("../../api.js", () => ({
  api: {
    harnessConfig: {
      set: { mutate: h.set },
      rememberSessionPair: { mutate: h.remember },
    },
  },
}));
vi.mock("../../lib/toast.js", () => ({ emitToast: () => {} }));
vi.mock("../../trpc.js", () => ({
  trpc: {
    harnessConfig: {
      status: { queryKey: () => "status" },
      snapshot: { queryKey: () => "snapshot" },
      sessionPair: { pathKey: () => "pair" },
      set: { mutationOptions: () => ({}) },
    },
    connections: {
      getAgentConnections: { queryKey: () => "grants" },
      list: { queryKey: () => "connections" },
    },
  },
}));
vi.mock("../../modules/agents/agent-trpc.js", () => ({}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  agentsKeys: { listWithChannels: () => "agents" },
}));
vi.mock(
  "../../modules/sessions/components/model-settings-snapshot.js",
  () => ({}),
);

import { useApplyHarnessConfig } from "../../modules/agents/api/harness-config.js";

beforeEach(() => {
  h.cache.clear();
  h.remember.mockReset().mockResolvedValue(undefined);
  h.set.mockReset().mockResolvedValue(undefined);
  h.cache.set("status", { defaultHarness: "claude-code", modelRouter: true });
  h.cache.set("grants", { connections: [{ connectionId: "conn-ibm" }] });
  h.cache.set("connections", [{ id: "conn-ibm", templateId: "ibm-litellm" }]);
});

function mutation() {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- the mocked useMutation returns its options
  return useApplyHarnessConfig() as unknown as {
    mutationFn: (change: {
      agentId: string;
      model?: string;
      unset?: string[];
    }) => Promise<void>;
  };
}

// TEST_SCENARIO: a rejected chat-default write is the user's choice not saved. The save must fail so the form stays dirty and the same choice can be retried, instead of acknowledging a successful save that leaves the old default in place.
test("a rejected chat-default write fails the save", async () => {
  h.remember.mockRejectedValueOnce(new Error("the model is not listed"));
  await expect(
    mutation().mutationFn({
      agentId: "a",
      model: "claude/ibm/claude-opus-5",
    }),
  ).rejects.toThrow("the model is not listed");
});

// TEST_SCENARIO: the model the user picked reaches the pair the relay starts a chat from, on the provider its qualified name names.
test("a successful model change sends the actual pair", async () => {
  await mutation().mutationFn({
    agentId: "a",
    model: "claude/ibm/claude-opus-5",
  });
  expect(h.remember).toHaveBeenCalledWith({
    agentId: "a",
    kind: "chat",
    harness: "claude-code",
    provider: "conn-ibm",
    model: "claude/ibm/claude-opus-5",
  });
});

// TEST_SCENARIO: an unset model names no pair the release can run, so it writes none; the panel does not offer it for a routed agent.
test("an unset model writes no pair", async () => {
  await mutation().mutationFn({ agentId: "a", unset: ["model"] });
  expect(h.remember).not.toHaveBeenCalled();
});

// TEST_OVERVIEW: A new session or terminal carries the picked harness, provider and model only when every harness with a harness config advertises sessionSettings. Older images ignore the pair (Pi falls back to its built-in Anthropic default), so they get no pair and run on the agent's defaults.
import type { HarnessCapability } from "agent-runtime-api";
import { beforeEach, expect, it, vi } from "vitest";

import { readNextSessionPair } from "../../modules/sessions/api/session-pair.js";

const cache = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("../../query-client.js", () => ({
  queryClient: { getQueryData: ([key]: [string]) => cache[key] },
}));
vi.mock("../../trpc.js", () => ({
  trpc: {
    harnessConfig: {
      status: { queryKey: () => ["status"] },
      sessionPair: { queryKey: () => ["remembered"] },
    },
    connections: {
      getAgentConnections: { queryKey: () => ["grants"] },
      list: { queryKey: () => ["connections"] },
    },
    templates: { harnesses: { queryKey: () => ["catalog"] } },
  },
}));
vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ nextSessionPair: {} }) },
}));
vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../../modules/agents/agent-trpc.js", () => ({ agentTrpc: vi.fn() }));

const pi = (sessionSettings?: string[]): HarnessCapability => ({
  name: "pi",
  harnessConfig: true,
  sessionModel: true,
  ...(sessionSettings && { sessionSettings }),
});

beforeEach(() => {
  cache.remembered = {
    harness: "pi",
    provider: "curve",
    model: "rits/zai-org/glm-5-3",
  };
  cache.grants = { connections: [{ connectionId: "curve" }] };
  cache.connections = [
    { id: "curve", name: "Curve", templateId: "curve-bender" },
  ];
  cache.catalog = {
    harnesses: [{ name: "pi", displayName: "Pi", providers: ["curve-bender"] }],
  };
});

// TEST_SCENARIO: A runtime that advertises sessionSettings routes the pair, so the remembered pair goes with the new session.
it("sends the pair to a runtime that routes it", () => {
  cache.status = { harnesses: [pi(["mode"])] };
  expect(readNextSessionPair("agent")?.pair).toMatchObject({
    harness: "pi",
    provider: "curve",
    model: "rits/zai-org/glm-5-3",
  });
});

// TEST_SCENARIO: An image built before per-session routing carries Pi but drops the pair's model, so no pair is sent.
it("sends no pair to an older runtime", () => {
  cache.status = { harnesses: [pi()] };
  expect(readNextSessionPair("agent")).toBeNull();
});

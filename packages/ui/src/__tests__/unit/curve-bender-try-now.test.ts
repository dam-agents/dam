// TEST_OVERVIEW: Try now on the CurveBender offer swaps an own-key CurveBender grant for the shared Connection and saves Pi on it as the new-chat default. An agent without Pi is refused before anything changes, and a failed step puts the grants back unless the default was saved.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  status: { harnesses: [{ name: "pi" }] as { name: string }[] | null },
  grants: ["conn-own", "conn-ibm"],
  pair: null as { provider: string | null } | null,
  update: vi.fn<(input: unknown) => Promise<void>>(),
  remember: vi.fn<(input: unknown) => Promise<void>>(),
}));
vi.mock("react", () => ({ useRef: (value: unknown) => ({ current: value }) }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
}));
vi.mock("../../query-client.js", () => ({
  queryClient: {
    getQueryData: () => [
      { id: "conn-own", templateId: "curve-bender" },
      { id: "conn-ibm", templateId: "ibm-litellm" },
      { id: "conn-shared", templateId: "curve-bender-deployment" },
    ],
  },
}));
vi.mock("../../api.js", () => ({
  api: {
    harnessConfig: {
      status: { query: async () => h.status },
      sessionPair: { query: async () => h.pair },
      rememberSessionPair: { mutate: h.remember },
    },
    connections: {
      getAgentConnections: {
        query: async () => ({
          connections: h.grants.map((connectionId) => ({ connectionId })),
        }),
      },
      updateAgentConnections: { mutate: h.update },
    },
  },
}));
vi.mock("../../trpc.js", () => ({
  trpc: {
    harnessConfig: { sessionPair: { pathKey: () => "pair" } },
    connections: {
      getAgentConnections: { queryKey: () => "grants" },
      list: { queryKey: () => "connections" },
    },
  },
}));
vi.mock("../../modules/agents/agent-trpc.js", () => ({}));
vi.mock("../../modules/agents/api/queries.js", () => ({}));
vi.mock(
  "../../modules/sessions/components/model-settings-snapshot.js",
  () => ({}),
);

import { useTryCurveBender } from "../../modules/agents/api/harness-config.js";

const useTryIt = () =>
  (
    useTryCurveBender() as unknown as {
      mutationFn: (v: { agentId: string; sharedId: string }) => Promise<void>;
    }
  ).mutationFn({ agentId: "a-1", sharedId: "conn-shared" });

const swap = { agentId: "a-1", grant: ["conn-shared"], revoke: ["conn-own"] };
const back = { agentId: "a-1", grant: ["conn-own"], revoke: ["conn-shared"] };

beforeEach(() => {
  h.status = { harnesses: [{ name: "pi" }] };
  h.pair = null;
  h.update.mockReset().mockResolvedValue(undefined);
  h.remember.mockReset().mockResolvedValue(undefined);
});

describe("Try now on the CurveBender offer", () => {
  // TEST_SCENARIO: the own-key grant is swapped for the shared one, the IBM grant stays, and Pi with the work model on the shared Connection is saved.
  it("swaps the grant and saves the Pi default", async () => {
    await useTryIt();
    expect(h.update.mock.calls).toEqual([[swap]]);
    expect(h.remember).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: "pi",
        provider: "conn-shared",
        model: expect.stringMatching(/^cb\/.*DeepSeek/),
      }),
    );
  });

  // TEST_SCENARIO: an agent that does not carry Pi is refused before any grant changes.
  it("refuses an agent without Pi", async () => {
    h.status = { harnesses: [{ name: "claude-code" }] };
    await expect(useTryIt()).rejects.toThrow(/can't run Pi/);
    expect(h.update).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a refused default, or a grant change that fails after storing, puts the grants back.
  it("puts the grants back when the default is not saved", async () => {
    h.remember.mockRejectedValueOnce(new Error("refused"));
    await expect(useTryIt()).rejects.toThrow("refused");
    expect(h.update.mock.calls).toEqual([[swap], [back]]);

    h.update.mockReset().mockRejectedValueOnce(new Error("fan-out"));
    await expect(useTryIt()).rejects.toThrow("fan-out");
    expect(h.update.mock.calls).toEqual([[swap], [back]]);
  });

  // TEST_SCENARIO: a default saved before a later step failed keeps the grants it runs on.
  it("keeps the grants when the default was saved", async () => {
    h.remember.mockImplementationOnce(async () => {
      h.pair = { provider: "conn-shared" };
      throw new Error("publish failed");
    });
    await expect(useTryIt()).rejects.toThrow("publish failed");
    expect(h.update.mock.calls).toEqual([[swap]]);
  });
});

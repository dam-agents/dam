// TEST_OVERVIEW: an agent can ask its gateway to inject a Connection's credential only into requests that name that Connection. The choice is made at create, by the create form or a starter kit, or later from the agent's settings, and travels to the controller on the Agent's spec. An agent that does not ask keeps no trace of the field, so its gateway renders as before.
import { describe, expect, it, vi } from "vitest";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

function setup() {
  const patchSpec = vi.fn(
    async (
      id: string,
      owner: string | undefined,
      patch: Record<string, unknown>,
    ) =>
      parseInfraAgent({
        metadata: {
          name: id,
          labels: { "agent-platform.ai/owner": owner ?? "owner-1" },
        },
        spec: {
          name: "test-agent",
          image: "example.com/agent:latest",
          ...patch,
        },
      }),
  );
  const persist = vi.fn(
    async (spec: Record<string, unknown>, owner: string, id: string) =>
      parseInfraAgent({
        metadata: { name: id, labels: { "agent-platform.ai/owner": owner } },
        spec,
      }),
  );
  const agents = createAgentsService({
    owner: "owner-1",
    repo: unused<AgentsDeps["repo"]>({
      list: async () => [],
      get: async (id) =>
        parseInfraAgent({
          metadata: {
            name: id,
            labels: { "agent-platform.ai/owner": "owner-1" },
          },
          spec: { name: "test-agent", image: "example.com/agent:latest" },
        }),
      create: persist,
      updateSpec: patchSpec,
    }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({
      replace: async () => {},
      list: async () => [],
    }),
    registrySecretPort: unused(),
    secretRefs: unused(),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentDefaultMounts: [],
    agentIdleTimeoutMinutes: 30,
    cleanupHooks: [],
    readTemplateSpec: async () => null,
    runtimeMutator: unused<AgentsDeps["runtimeMutator"]>({
      bump: async () => 1,
    }),
    contributionsProgress: unused(),
    podStatus: unused(),
    resizeLock: (_key, fn) => fn(),
    listChannelsByOwner: async () => new Map(),
    listChannelsByAgent: async () => [],
    deleteChannelByType: async () => {},
    deleteSlackChannelByAgent: async () => false,
    deleteChannelsByAgentIds: async () => {},
    unitOfWork: unused(),
    channelsTxRepo: unused(),
    resolveSlackWorkspace: async () => ({ kind: "unknown" }),
    findSlackBindings: async () => [],
    onboardingChecklists: { readMany: async () => new Map() },
  });
  return { agents, persist, patchSpec };
}

const create = { name: "test-agent", image: "example.com/agent:latest" };

describe("an agent's connection addressing", () => {
  // TEST_SCENARIO: an agent created asking for addressed injection carries the field on its spec, which is all the controller reads.
  it("reaches the spec when the create asks for it", async () => {
    const { agents, persist } = setup();
    await agents.create({ ...create, requireConnectionAddress: true });
    expect(persist.mock.calls[0]![0]).toMatchObject({
      requireConnectionAddress: true,
    });
  });

  // TEST_SCENARIO: an agent that does not ask, or explicitly declines, has no field at all, so nothing about its gateway changes.
  it.each([undefined, false])(
    "is absent from the spec when %s",
    async (value) => {
      const { agents, persist } = setup();
      await agents.create({ ...create, requireConnectionAddress: value });
      expect(persist.mock.calls[0]![0]).not.toHaveProperty(
        "requireConnectionAddress",
      );
    },
  );

  // TEST_SCENARIO: the settings switch turns the mode on for an existing agent by setting the field, and off by removing it, so an agent switched off looks like one that never asked.
  it.each([
    [true, true],
    [false, null],
  ])("is set from settings: %s patches %s", async (value, patched) => {
    const { agents, patchSpec } = setup();
    await agents.update({ id: "agent-1", requireConnectionAddress: value });
    expect(patchSpec.mock.calls[0]![2]).toEqual({
      requireConnectionAddress: patched,
    });
  });

  // TEST_SCENARIO: a settings save that does not touch the switch leaves the field alone.
  it("is untouched by an update that does not name it", async () => {
    const { agents, patchSpec } = setup();
    await agents.update({ id: "agent-1", name: "renamed" });
    expect(patchSpec.mock.calls[0]![2]).not.toHaveProperty(
      "requireConnectionAddress",
    );
  });
});

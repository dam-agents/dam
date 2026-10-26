// TEST_OVERVIEW: an Agent asks for nested virtualization at create, and the ask reaches its spec where the controller reads it, under the vm backend; an Agent that does not ask carries none. The controller's NestedVirtualization condition becomes the Agent's nesting: whether its machine got it, and the reason when it did not; an Agent without the condition has none.
import type { RuntimeFeatures } from "agent-runtime-api";
import { describe, expect, it, vi } from "vitest";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import {
  assembleAgent,
  parseInfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";

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
    actor: "owner-1",
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
    agentIdleTimeoutMinutes: 5,
    cleanupHooks: [],
    readTemplateSpec: async () => null,
    runtimeMutator: unused<AgentsDeps["runtimeMutator"]>({
      bump: async () => 1,
      enqueueAfterCommit: async () => {},
    }),
    contributionsProgress: unused(),
    agentServiceStatus: unused(),
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
    editors: unused<AgentsDeps["editors"]>(),
    editorEmail: null,
    resolveUserEmail: async () => null,
  });
  return { agents, persist, patchSpec };
}

const create = { name: "test-agent", image: "example.com/agent:latest" };

const agentWith = (conditions: Record<string, unknown>[]) =>
  assembleAgent(
    parseInfraAgent({
      metadata: { name: "a", generation: 1 },
      spec: { name: "a" },
      status: { conditions },
    }),
    [],
    [],
    5,
    false,
    undefined,
    {} as RuntimeFeatures,
    [],
    [],
  );

describe("asking for nested virtualization", () => {
  // TEST_SCENARIO: a create that asks puts the ask under spec.backend.vm, the one place the controller reads it, and keeps the backend a vm one.
  it("reaches the spec under the vm backend", async () => {
    const { agents, persist } = setup();
    await agents.create({ ...create, nestedVirtualization: true });
    expect(persist.mock.calls[0]![0]).toMatchObject({
      backend: { type: "vm", vm: { nestedVirtualization: true } },
    });
  });

  // TEST_SCENARIO: a create that does not ask leaves the backend without a vm block, so its machine boots without nesting.
  it("is absent from the spec when the create does not ask", async () => {
    const { agents, persist } = setup();
    await agents.create(create);
    expect(persist.mock.calls[0]![0]).toMatchObject({
      backend: { type: "vm" },
    });
    expect(
      (persist.mock.calls[0]![0] as { backend: object }).backend,
    ).not.toHaveProperty("vm");
  });
});

describe("whether the machine nests", () => {
  // TEST_SCENARIO: the condition says whether the machine got nesting, and when it did not, the controller's reason and message, which name the install or the node that refused it.
  it("reads the NestedVirtualization condition", () => {
    expect(
      agentWith([
        { type: "NestedVirtualization", status: "True", reason: "Enabled" },
      ]).nesting,
    ).toEqual({ enabled: true, reason: "Enabled", message: "" });
    expect(
      agentWith([
        {
          type: "NestedVirtualization",
          status: "False",
          reason: "NotAllowedByInstall",
          message: "this install does not let machines nest",
        },
      ]).nesting,
    ).toEqual({
      enabled: false,
      reason: "NotAllowedByInstall",
      message: "this install does not let machines nest",
    });
  });

  // TEST_SCENARIO: an Agent that never asked carries no condition, and so no nesting at all.
  it("has none without the condition", () => {
    expect(agentWith([]).nesting).toBeUndefined();
  });
});

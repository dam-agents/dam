// TEST_OVERVIEW: an owner picks one of the fixed avatar characters for an agent at create or later in its settings. The choice travels on the Agent's spec, so the UI and Slack show the same character, and renaming the agent keeps it. An agent with no choice shows the character picked from its owner and name.
import { avatarCharacter } from "api-server-api/avatar/svg";
import { toAgentView } from "api-server-api";
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

describe("an agent's chosen avatar", () => {
  // TEST_SCENARIO: the character picked on the create page is stored on the spec, and the agent view returns it.
  it("is stored at create and shown in the view", async () => {
    const { agents, persist } = setup();
    const created = await agents.create({ ...create, avatar: "lens" });
    expect(persist.mock.calls[0]![0]).toMatchObject({ avatar: "lens" });
    expect(toAgentView(created).avatar).toBe("lens");
  });

  // TEST_SCENARIO: an agent created without a choice has no field, so the UI and Slack fall back to the character picked from its owner and name.
  it("is absent when none is chosen", async () => {
    const { agents, persist } = setup();
    const created = await agents.create(create);
    expect(persist.mock.calls[0]![0]).not.toHaveProperty("avatar");
    expect(toAgentView(created).avatar).toBeNull();
  });

  // TEST_SCENARIO: the settings picker changes the character, and a save that does not touch it leaves it alone.
  it("is changed only by an update that names it", async () => {
    const { agents, patchSpec } = setup();
    await agents.update({ id: "agent-1", avatar: "wave" });
    await agents.update({ id: "agent-1", name: "renamed" });
    expect(patchSpec.mock.calls[0]![2]).toEqual({ avatar: "wave" });
    expect(patchSpec.mock.calls[1]![2]).not.toHaveProperty("avatar");
  });
});

describe("avatarCharacter", () => {
  // TEST_SCENARIO: a stored value that is not a known character, such as one written by hand on the Agent resource, falls back to the picked character instead of breaking the avatar.
  it("falls back to the picked character for an unknown value", () => {
    expect(avatarCharacter("lens", "owner-1", "a")).toBe("lens");
    expect(avatarCharacter("dragon", "owner-1", "a")).toBe(
      avatarCharacter(undefined, "owner-1", "a"),
    );
  });
});

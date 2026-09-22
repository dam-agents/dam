// TEST_OVERVIEW: An Agent's avatar is a seed the UI draws a robot head from. Create and update store the chosen seed; an Agent with no stored seed shows its own ID as the seed, so every Agent has a stable avatar.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
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

const OWNER = "owner-1";

function infraOf(id: string, spec: Record<string, unknown>) {
  return parseInfraAgent({
    metadata: { name: id, labels: { "agent-platform.ai/owner": OWNER } },
    spec,
  });
}

function setup(stored: Map<string, string> = new Map()) {
  const setAvatar = vi.fn(async (agentId: string, seed: string) => {
    stored.set(agentId, seed);
  });
  const agents = createAgentsService({
    owner: OWNER,
    repo: unused<AgentsDeps["repo"]>({
      create: async (spec, _owner, id) => infraOf(id, spec),
      get: async (id) => infraOf(id, { name: "my-agent", image: "img:1" }),
      updateSpec: async (id) =>
        infraOf(id, { name: "my-agent", image: "img:1" }),
    }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({
      list: async () => [],
      replace: async () => {},
    }),
    registrySecretPort: unused(),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
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
    upsertChannel: async () => {},
    deleteChannelByType: async () => {},
    deleteSlackChannelByAgent: async () => false,
    deleteChannelsByAgentIds: async () => {},
    unitOfWork: unused(),
    channelsTxRepo: unused(),
    resolveSlackWorkspace: async () => ({ kind: "unknown" }),
    findSlackBindings: async () => [],
    onboardingChecklists: { readMany: async () => new Map() },
    avatars: {
      readMany: async (ids) =>
        new Map(
          ids.flatMap((id) => {
            const seed = stored.get(id);
            return seed === undefined ? [] : [[id, seed] as const];
          }),
        ),
      set: setAvatar,
    },
  });
  const ctx = unused<ApiContext>({
    agents,
    invocationsQuery: unused<ApiContext["invocationsQuery"]>({
      listTargets: async () => [],
    }),
    user: {
      sub: OWNER,
      preferredUsername: "test",
      scopes: ["agents:manage"],
      agentIds: "*",
      keyId: "key-1",
    },
  });
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), setAvatar };
}

describe("agent avatars", () => {
  // TEST_SCENARIO: The create form sends the seed the user picked. It must be stored against the new Agent and returned on the view.
  it("stores the avatar chosen at create", async () => {
    const { caller, setAvatar } = setup();
    const result = await caller.agents.create({
      name: "my-agent",
      image: "img:1",
      avatar: "k3v9x2qa",
    });
    expect(setAvatar).toHaveBeenCalledWith(result.id, "k3v9x2qa");
    expect(result.avatar).toBe("k3v9x2qa");
  });

  // TEST_SCENARIO: API callers and older clients create without an avatar. The Agent still needs a stable avatar, so the view falls back to the Agent ID and nothing is stored.
  it("falls back to the agent id when no avatar was chosen", async () => {
    const { caller, setAvatar } = setup();
    const result = await caller.agents.create({
      name: "my-agent",
      image: "img:1",
    });
    expect(setAvatar).not.toHaveBeenCalled();
    expect(result.avatar).toBe(result.id);
  });

  // TEST_SCENARIO: The settings page rerolls the avatar. The new seed must replace the stored one and show on the returned view.
  it("replaces the avatar on update", async () => {
    const stored = new Map([["agent-a", "oldseed1"]]);
    const { caller, setAvatar } = setup(stored);
    const result = await caller.agents.update({
      id: "agent-a",
      avatar: "newseed2",
    });
    expect(setAvatar).toHaveBeenCalledWith("agent-a", "newseed2");
    expect(result.avatar).toBe("newseed2");
  });

  // TEST_SCENARIO: The seed is echoed into markup and storage keys, so the API accepts only a short lowercase token.
  it("rejects a malformed avatar before any write", async () => {
    const { caller, setAvatar } = setup();
    await expect(
      caller.agents.update({ id: "agent-a", avatar: "<script>" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(setAvatar).not.toHaveBeenCalled();
  });
});

// TEST_OVERVIEW: the CLI addresses an agent by its name, so an owner's agent names must stay unambiguous. Create and rename apply the same rules: a name cannot have the shape of an agent ID, and no two agents of one owner share a name. An agent that already shares its name with another can still be saved under that name.
import { TRPCError } from "@trpc/server";
import { agentUpdateInputSchema } from "api-server-api";
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

function agent(id: string, name: string, owner = "owner-1") {
  return parseInfraAgent({
    metadata: { name: id, labels: { "agent-platform.ai/owner": owner } },
    spec: { name, image: "example.com/agent:latest" },
  });
}

function setup(existing: ReturnType<typeof agent>[]) {
  const create = vi.fn(
    async (spec: Record<string, unknown>, owner: string, id: string) =>
      parseInfraAgent({
        metadata: { name: id, labels: { "agent-platform.ai/owner": owner } },
        spec,
      }),
  );
  const updateSpec = vi.fn(
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
        spec: { name: "x", image: "example.com/agent:latest", ...patch },
      }),
  );
  const agents = createAgentsService({
    owner: "owner-1",
    repo: unused<AgentsDeps["repo"]>({
      list: async (owner) => existing.filter((a) => a.owner === owner),
      get: async (id) => existing.find((a) => a.id === id) ?? null,
      create,
      updateSpec,
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
  return { agents, create, updateSpec };
}

async function expectConflict(p: Promise<unknown>) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe("CONFLICT");
}

const image = "example.com/agent:latest";

describe("agent name rules", () => {
  // TEST_SCENARIO: the config page sends a rename through the update schema, which must refuse an ID-shaped name just as create does, or the CLI would fetch a different agent by that ref.
  it("refuses a rename to the shape of an agent ID", () => {
    expect(
      agentUpdateInputSchema.safeParse({
        id: "agent-1",
        name: "agent-7f418353a3201fec",
      }).success,
    ).toBe(false);
    expect(
      agentUpdateInputSchema.safeParse({ id: "agent-1", name: "agent-2" })
        .success,
    ).toBe(true);
  });

  // TEST_SCENARIO: creating a second agent under a name the owner already uses fails with CONFLICT and writes nothing, while another owner's agent of that name does not block it.
  it("refuses a create under a name the owner already uses", async () => {
    const { agents, create } = setup([
      agent("agent-a", "taken"),
      agent("agent-b", "theirs", "owner-2"),
    ]);
    await expectConflict(agents.create({ name: "taken", image }));
    expect(create).not.toHaveBeenCalled();
    await agents.create({ name: "theirs", image });
    expect(create).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: renaming an agent to the name of another of the owner's agents fails with CONFLICT and leaves the spec untouched.
  it("refuses a rename to another agent's name", async () => {
    const { agents, updateSpec } = setup([
      agent("agent-a", "taken"),
      agent("agent-b", "mine"),
    ]);
    await expectConflict(agents.update({ id: "agent-b", name: "taken" }));
    expect(updateSpec).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: two agents that shared a name before the rule existed can each still be saved under their current name, so a settings save does not lock them out.
  it("lets an existing duplicate keep its name", async () => {
    const { agents, updateSpec } = setup([
      agent("agent-a", "dup"),
      agent("agent-b", "dup"),
    ]);
    await agents.update({ id: "agent-b", name: "dup", description: "d" });
    expect(updateSpec).toHaveBeenCalledOnce();
  });
});

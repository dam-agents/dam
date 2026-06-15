import { describe, it, expect } from "vitest";
import type { AgentCreateInput } from "api-server-api";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import type { AgentRegistrySecretPort } from "../../modules/agents/infrastructure/agent-registry-secret-port.js";

type Deps = Parameters<typeof createAgentsService>[0];

function fakeRepo(create: AgentsRepository["create"]): AgentsRepository {
  return { create } as unknown as AgentsRepository;
}

function fakeRegistryPort() {
  const calls: string[] = [];
  const port: AgentRegistrySecretPort = {
    secretName: (agentId) => `${agentId}-registry-pull`,
    create: async (agentId) => {
      calls.push(`create:${agentId}`);
    },
    delete: async (agentId) => {
      calls.push(`delete:${agentId}`);
    },
    listAgentIds: async () => [],
  };
  return { port, calls };
}

function makeDeps(overrides: Partial<Deps>): Deps {
  const unsupported = () => {
    throw new Error("not used in this test");
  };
  const base = {
    repo: {} as AgentsRepository,
    owner: "owner-1",
    readTemplateSpec: unsupported,
    runtimeMutator: { bump: async () => {} },
    contributionsSettled: {
      status: async () => ({
        settled: true,
        failures: [],
        preparingWorkspace: false,
      }),
      statusMany: async () => new Map(),
    },
    listChannelsByOwner: async () => new Map(),
    listChannelsByAgent: async () => [],
    upsertChannel: async () => {},
    deleteChannelByType: async () => {},
    deleteChannelsByAgentIds: async () => {},
    unitOfWork: (async (fn: (tx: unknown) => unknown) =>
      fn({})) as Deps["unitOfWork"],
    channelsTxRepo: {
      upsertChannel: async () => {},
      listByAgent: async () => [],
    },
    channelSecretStore: {} as Deps["channelSecretStore"],
    listAllowedUsersByOwner: async () => new Map(),
    listAllowedUsersByAgent: async () => [],
    setAllowedUsers: async () => {},
    deleteAllowedUsersByAgentIds: async () => {},
    userDirectory: {} as Deps["userDirectory"],
  } as unknown as Deps;
  return { ...base, ...overrides };
}

const createInput: AgentCreateInput = {
  name: "my-agent",
  image: "registry.example.com/private/agent:1",
  registryCredential: {
    server: "registry.example.com",
    username: "u",
    password: "p",
  },
};

describe("AgentsService.create with registryCredential", () => {
  it("writes the pull Secret before the CR and sets imagePullSecretRef", async () => {
    const { port, calls } = fakeRegistryPort();
    let createdSpec: Record<string, unknown> | undefined;
    let createdName: string | undefined;

    const service = createAgentsService(
      makeDeps({
        registrySecretPort: port,
        repo: fakeRepo(async (spec, _owner, _templateId, name) => {
          calls.push(`repo.create:${name}`);
          createdSpec = spec;
          createdName = name;
          return {
            id: name!,
            name: "my-agent",
            spec,
          } as unknown as InfraAgent;
        }),
      }),
    );

    await service.create(createInput);

    const created = calls.find((c) => c.startsWith("create:"))!;
    const agentId = created.slice("create:".length);
    expect(calls).toEqual([`create:${agentId}`, `repo.create:${agentId}`]);
    expect(createdName).toBe(agentId);
    expect(createdSpec?.imagePullSecretRef).toBe(`${agentId}-registry-pull`);
  });

  it("rolls back the pull Secret when CR creation fails", async () => {
    const { port, calls } = fakeRegistryPort();
    const service = createAgentsService(
      makeDeps({
        registrySecretPort: port,
        repo: fakeRepo(async () => {
          throw new Error("k8s admission rejected");
        }),
      }),
    );

    await expect(service.create(createInput)).rejects.toThrow(
      "k8s admission rejected",
    );

    const created = calls.find((c) => c.startsWith("create:"))!;
    const agentId = created.slice("create:".length);
    expect(calls).toContain(`delete:${agentId}`);
  });

  it("does not touch the registry port when no credential is supplied", async () => {
    const { port, calls } = fakeRegistryPort();
    const service = createAgentsService(
      makeDeps({
        registrySecretPort: port,
        repo: fakeRepo(
          async (spec) =>
            ({
              id: "agent-x",
              name: "my-agent",
              spec,
            }) as unknown as InfraAgent,
        ),
      }),
    );

    await service.create({ name: "my-agent", image: "public/agent:1" });
    expect(calls).toEqual([]);
  });
});

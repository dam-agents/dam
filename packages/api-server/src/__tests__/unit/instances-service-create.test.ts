import { describe, it, expect, vi } from "vitest";
import { TRPCError, initTRPC } from "@trpc/server";
import type { Agent, CreateInstanceInput } from "api-server-api";
import { appRouter } from "api-server-api/router";
import type { ApiContext } from "api-server-api";
import type { InstancesRepository } from "../../modules/instances/infrastructure/instances-repository.js";
import type { InfraInstance } from "../../modules/instances/domain/instance-assembly.js";
import { createInstancesService } from "../../modules/instances/services/instances-service.js";

const OWNER = "alice";
const AGENT_ID = "agent-1";

function makeAgent(): Agent {
  return {
    id: AGENT_ID,
    name: "claude-code",
    spec: { version: "agent-platform.ai/v1", name: "claude-code", image: "x" },
  };
}

function makeInfra(overrides: Partial<InfraInstance> = {}): InfraInstance {
  return {
    id: "inst-existing",
    name: "existing",
    agentId: AGENT_ID,
    desiredState: "running",
    currentState: "running",
    podReady: true,
    ...overrides,
  };
}

function makeRepo(initial: InfraInstance[] = []): InstancesRepository {
  const created = vi.fn(
    async (agentId: string, spec: Record<string, unknown>, owner: string) =>
      ({
        id: "inst-new",
        name: (spec.name as string) ?? "new",
        agentId,
        desiredState: "running",
        podReady: false,
        _owner: owner,
      }) as InfraInstance,
  );
  return {
    list: vi.fn(async () => initial),
    get: vi.fn(),
    create: created,
    updateSpec: vi.fn(),
    delete: vi.fn(),
    restart: vi.fn(),
    wake: vi.fn(),
    isOwnedBy: vi.fn(),
    getOwner: vi.fn(),
    resolveIdentity: vi.fn(),
    patchAnnotation: vi.fn(),
    wakeIfHibernated: vi.fn(),
    isPodReady: vi.fn(),
    ensureReady: vi.fn(),
  } as unknown as InstancesRepository;
}

function makeService(opts: {
  owner: string | undefined;
  repo: InstancesRepository;
  getAgent?: (id: string) => Promise<Agent | null>;
}) {
  return createInstancesService({
    repo: opts.repo,
    owner: opts.owner,
    getAgent: opts.getAgent ?? (async () => makeAgent()),
    listChannelsByOwner: async () => new Map(),
    listChannelsByInstance: async () => [],
    upsertChannel: async () => {},
    deleteChannelByType: async () => {},
    deleteChannelsByInstanceIds: async () => {},
    unitOfWork: (async (fn: (tx: unknown) => unknown) => fn({})) as never,
    channelsTxRepo: {
      upsertChannel: async () => {},
      listByInstance: async () => [],
    },
    channelSecretStore: {
      storeTelegramToken: async () => {},
      deleteChannelSecret: async () => {},
    } as never,
    listAllowedUsersByOwner: async () => new Map(),
    listAllowedUsersByInstance: async () => [],
    setAllowedUsers: async () => {},
    deleteAllowedUsersByInstanceIds: async () => {},
    userDirectory: {
      resolveByEmail: async () => null,
      resolveManyBySub: async () => new Map(),
    } as never,
  });
}

const CREATE_INPUT: CreateInstanceInput = {
  name: "fresh",
  agentId: AGENT_ID,
};

describe("instances-service.create — name uniqueness", () => {
  it("creates with a fresh name", async () => {
    const repo = makeRepo([makeInfra({ name: "other" })]);
    const svc = makeService({ owner: OWNER, repo });

    const instance = await svc.create(CREATE_INPUT);

    expect(instance.name).toBe("fresh");
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it("rejects with CONFLICT when an instance with the same name exists for the same owner", async () => {
    const repo = makeRepo([makeInfra({ name: "fresh" })]);
    const svc = makeService({ owner: OWNER, repo });

    let caught: unknown;
    try {
      await svc.create(CREATE_INPUT);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("CONFLICT");
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("instances router — `inst-` prefix is rejected at validation", () => {
  const t = initTRPC.context<ApiContext>().create();
  const createCaller = t.createCallerFactory(appRouter);

  it("rejects names beginning with the Reserved ID Prefix as BAD_REQUEST without invoking the service", async () => {
    const instances = {
      create: vi.fn(),
    };
    const caller = createCaller({ instances } as unknown as ApiContext);

    let caught: unknown;
    try {
      await caller.instances.create({ name: "inst-foo", agentId: AGENT_ID });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("BAD_REQUEST");
    expect(instances.create).not.toHaveBeenCalled();
  });
});

// TEST_OVERVIEW: The permission check that guards an Agent's destructive operations reads the Agent from the store, not from the informer. A replica whose cache has not yet observed an assistant another replica created must still refuse its deletion — including for an owner API key, which the editor path never covers — and a record that cannot be read at all is refused rather than read as permission.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext, UserIdentity } from "api-server-api";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { AgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { createActOnAgent } from "../../apps/api-server/trpc/act-on-agent.js";
import { createOwnerPermissions } from "../../apps/api-server/trpc/owner-permissions.js";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";

const ID = "agent-00000000000000a1";
const OWNER = "alice";
const NAME = "Dambledore";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const liveObject = (kind?: string) => ({
  metadata: {
    name: ID,
    labels: { "agent-platform.ai/owner": OWNER },
    ...(kind ? { annotations: { "agent-platform.ai/agent-kind": kind } } : {}),
  },
  spec: { name: NAME, image: "example.com/agent:latest" },
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: the world the repro describes — another replica has
 * created the assistant, so the store has it, while this replica's synced
 * informer has not observed it yet. The store adapter is the real one; only the
 * Kubernetes calls behind it are faked.
 */
function setup(opts: {
  informerSees: boolean;
  live: ReturnType<typeof liveObject> | null;
  liveReadFails?: boolean;
}) {
  const deleted = { count: 0 };
  const repo = createAgentsRepository(
    unused<K8sClient>({
      getCustomObject: async () => {
        if (opts.liveReadFails)
          throw new Error("the API server did not answer");
        return opts.live;
      },
      deleteCustomObject: async () => {
        deleted.count += 1;
      },
    }),
    unused<AgentStateCache>({
      // TEST_SCENARIO: a synced cache that has not observed the Agent — the informer knows nothing.
      get: async () => (opts.informerSees ? (opts.live ?? null) : null),
    }),
  );
  const agents = createAgentsService({
    owner: OWNER,
    actor: OWNER,
    editorEmail: null,
    resolveUserEmail: async () => null,
    assistantName: NAME,
    repo,
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>(),
    registrySecretPort: unused<AgentsDeps["registrySecretPort"]>(),
    secretRefs: unused<AgentsDeps["secretRefs"]>(),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentIdleTimeoutMinutes: 5,
    cleanupHooks: [],
    readTemplateSpec: async () => null,
    runtimeMutator: unused<AgentsDeps["runtimeMutator"]>(),
    contributionsProgress: unused<AgentsDeps["contributionsProgress"]>(),
    agentServiceStatus: unused<AgentsDeps["agentServiceStatus"]>(),
    listChannelsByOwner: async () => new Map(),
    listChannelsByAgent: async () => [],
    deleteChannelByType: async () => {},
    deleteSlackChannelByAgent: async () => false,
    deleteChannelsByAgentIds: async () => {},
    unitOfWork: unused<AgentsDeps["unitOfWork"]>(),
    channelsTxRepo: unused<AgentsDeps["channelsTxRepo"]>(),
    resolveSlackWorkspace: async () => ({ kind: "unknown" }),
    findSlackBindings: async () => [],
    onboardingChecklists: { readMany: async () => new Map() },
    editors: unused<AgentsDeps["editors"]>(),
  });
  const user: UserIdentity = {
    sub: OWNER,
    preferredUsername: OWNER,
    scopes: ["agents:manage", "agents:operate"],
    agentIds: "*",
    keyId: "owner-api-key",
  };
  const ctx = { user, agents } as unknown as ApiContext;
  ctx.actOnAgent = createActOnAgent({
    user,
    self: () => ctx,
    agentOfTarget: async (target) =>
      target.kind === "agent" ? { agentId: target.agentId, needs: [] } : null,
    // UNIT_BOUNDARY_DESCRIPTION: the factory's own wiring, not a copy of it.
    ownerPermissions: createOwnerPermissions({ repo }),
    editorStanding: async () => null,
    contextFor: () => ctx,
    assistantName: NAME,
  });
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), deleted, repo };
}

describe("an assistant absent from the informer", () => {
  // TEST_SCENARIO: the repro — the store has the assistant, this replica's synced informer does not, and the caller is an owner API key, which no editor check covers. The deletion is refused and nothing is deleted.
  it("cannot be deleted by an owner API key", async () => {
    const w = setup({ informerSees: false, live: liveObject("assistant") });
    await expect(w.caller.agents.delete({ id: ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(w.deleted.count).toBe(0);
  });

  // TEST_SCENARIO: the same read refuses the other permissions the assistant holds back, so the hole was the read, not one procedure.
  it("cannot be disabled or handed to an editor either", async () => {
    const w = setup({ informerSees: false, live: liveObject("assistant") });
    await expect(
      w.caller.agents.setDisabled({ id: ID, disabled: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      w.caller.agents.setEditors({ id: ID, editors: ["bob@example.com"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // TEST_SCENARIO: a record that cannot be read at all is not permission: the request is refused rather than allowed through on an inconclusive read.
  it("is refused when its record cannot be read", async () => {
    const w = setup({
      informerSees: false,
      live: liveObject("assistant"),
      liveReadFails: true,
    });
    await expect(w.caller.agents.delete({ id: ID })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(w.deleted.count).toBe(0);
  });

  // TEST_SCENARIO: an ordinary Agent this replica has not observed yet is still deletable — the store read answers for it, so the fix costs nothing outside the assistant.
  it("leaves any other Agent deletable", async () => {
    const w = setup({ informerSees: false, live: liveObject() });
    await w.caller.agents.delete({ id: ID });
    expect(w.deleted.count).toBe(1);
  });

  // TEST_SCENARIO: the check reads the store, so a cache that claims the Agent is there while the store has nothing does not invent one: nothing is deleted.
  it("trusts the store, not the cache", async () => {
    const w = setup({ informerSees: true, live: null });
    await w.caller.agents.delete({ id: ID });
    expect(w.deleted.count).toBe(0);
  });
});

describe("the owner permissions lookup", () => {
  // TEST_SCENARIO: the lookup answers the owner's permissions for the Agent's kind, and null for anyone else, without asking the informer at all.
  it("reads the agent once, from the store", async () => {
    const getLive = vi.fn(async () => ({
      owner: OWNER,
      kind: "assistant" as const,
    }));
    const permissions = createOwnerPermissions({
      repo: { getLive } as never,
    });
    expect(await permissions(ID, OWNER)).not.toContain("delete");
    expect(await permissions(ID, "bob")).toBeNull();
    expect(getLive).toHaveBeenCalledTimes(2);
  });
});

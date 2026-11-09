// TEST_OVERVIEW: A fresh owner with the shared CurveBender key configured: the assistant's provisioning create takes the owner's Default profile the way any create does — reconciling the deployment-owned Connection first (#6317) — so it starts on Pi with the Default bound and the shared CurveBender granted, rather than on the install's default harness with no provider. Nothing in the assistant path asks for a harness, template or provider of its own, so this ordering is the create's own.
import { describe, expect, it, vi } from "vitest";
import type { HarnessCatalog, TemplateSpec } from "api-server-api";
import { CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } from "api-server-api";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { connectionGrantProvisioner } from "../../modules/agents/compose.js";
import type { ProfilesRepository } from "../../modules/profiles/infrastructure/profiles-repository.js";
import { newAgentDefault } from "../../modules/profiles/services/profiles-service.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

const OWNER = "owner-1";
const SHARED = "conn-curve-bender";

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

/** UNIT_BOUNDARY_DESCRIPTION: the profiles tables and the deployment-owned Connection, as a fresh account meets them: no profile, no Connection, and a reconcile that makes the shared CurveBender Connection the way a Connection listing would. */
function world() {
  const profiles: {
    id: string;
    name: string;
    harness: string;
    providerTemplate: string;
    model: string;
  }[] = [];
  let connections: { id: string; templateId: string }[] = [];
  let defaultId: string | null = null;
  const state = {
    granted: [] as string[],
    boundTo: null as string | null,
    reconcileCalls: 0,
  };
  const repo = unused<ProfilesRepository>({
    defaultOf: async () =>
      (profiles.find((p) => p.id === defaultId) ?? null) as never,
    list: async () => profiles as never,
    seed: async (
      _owner: string,
      write: {
        name: string;
        harness: string;
        providerTemplate: string;
        model: string;
      },
    ) => {
      profiles.push({ id: "profile-default", ...write });
    },
    setDefault: async (_owner: string, id: string) => {
      defaultId = id;
    },
    ownerConnections: async () => connections as never,
    agentConnections: async () => connections as never,
    bindChatProfile: async (
      _owner: string,
      agentId: string,
      profileId: string,
    ) => {
      state.boundTo = `${agentId}:${profileId}`;
      return true;
    },
  } as never);
  const reconcileConnections = async () => {
    state.reconcileCalls += 1;
    connections = [
      { id: SHARED, templateId: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID },
    ];
  };
  const defaultProfile = async () =>
    newAgentDefault({
      repo,
      owner: OWNER,
      catalog: {
        default: "claude-code",
        harnesses: [],
      } as unknown as HarnessCatalog,
      seed: {
        harness: "pi",
        model: "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
      },
      ownerCatalog: async () =>
        ({ defaultHarness: "claude-code", providers: [] }) as never,
      reconcileConnections,
    }).then(
      (chosen) =>
        chosen && {
          name: chosen.profile.name,
          model: chosen.profile.model,
          harness: chosen.profile.harness,
          connectionId: chosen.connectionId,
          bind: async (agentId: string) =>
            (await repo.bindChatProfile(OWNER, agentId, chosen.profile.id))
              ? null
              : "the agent already holds a chat default",
        },
    );
  const saved = { id: "", spec: {} as Record<string, unknown> };
  const agents = createAgentsService({
    defaultHarness: "claude-code",
    owner: OWNER,
    actor: OWNER,
    repo: unused<AgentsDeps["repo"]>({
      list: async () => [],
      create: async (
        spec: Record<string, unknown>,
        _owner: string,
        id: string,
      ) => {
        saved.spec = spec;
        saved.id = id;
        return {
          id,
          name: spec.name,
          owner: OWNER,
          spec,
        } as never;
      },
    }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({
      list: async () => [],
      insertMissing: async () => undefined,
      replace: async () => undefined,
    }),
    registrySecretPort: unused<AgentsDeps["registrySecretPort"]>({
      create: async () => undefined,
      secretName: () => "registry",
    }),
    secretRefs: unused(),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentIdleTimeoutMinutes: 5,
    cleanupHooks: [],
    readTemplateSpec: async () => ({
      spec: { image: "quay.io/example/agent:latest" } as TemplateSpec,
    }),
    runtimeMutator: unused<AgentsDeps["runtimeMutator"]>({
      bump: async () => 1,
    }),
    contributionsProgress: unused(),
    agentServiceStatus: unused(),
    grantProvisioner: connectionGrantProvisioner(
      unused<Parameters<typeof connectionGrantProvisioner>[0]>({
        validateProviderConnection: async () => undefined,
        validateGrantSet: async () => undefined,
        setAgentConnections: async (_agentId: string, ids: string[]) => {
          state.granted = [...ids];
        },
        defaultProviderConnections: async () => connections as never,
        listConnections: async () => connections as never,
        getAgentConnections: async () => ({ connections: [] }) as never,
      } as never),
      { harnesses: [] } as unknown as HarnessCatalog,
    ),
    defaultProfile: vi.fn(defaultProfile),
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
    editors: unused(),
    editorEmail: null,
    resolveUserEmail: async () => null,
    assistantName: "Dambledore",
  });
  return { agents, state, saved, profiles };
}

describe("a fresh owner's assistant with the shared CurveBender key set", () => {
  // TEST_SCENARIO: the assistant's create takes the Default profile the reconcile just made usable: the spec harness is Pi, the shared CurveBender is the connection it is granted, and the Default is bound as its chat default — the same start any Agent gets.
  it("starts on the Default profile with the shared provider granted", async () => {
    const w = world();
    await w.agents.create({ name: "Dambledore", kind: "assistant" });

    expect(w.state.reconcileCalls).toBe(1);
    expect(w.saved.spec.harness).toBe("pi");
    expect(w.state.granted).toEqual([SHARED]);
    expect(w.state.boundTo).toBe(`${w.saved.id}:profile-default`);
    expect(w.profiles[0]).toMatchObject({
      harness: "pi",
      providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    });
  });
});

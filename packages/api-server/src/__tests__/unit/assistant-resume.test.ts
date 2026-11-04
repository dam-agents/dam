// TEST_OVERVIEW: A resumed create finishes an Agent whose store write already happened — the assistant whose first create died half-way. It reads the Agent from the store, writes nothing new there, announces nothing (the create that made the Agent did that), and adds only what the Agent is missing: environment variables, the trusted egress preset, the first provider grants and its chat default. An edit its owner made since therefore survives the retry.
import { describe, expect, it, vi } from "vitest";
import type { DomainEvent } from "../../events.js";
import { events$ } from "../../events.js";
import type { Subscription } from "rxjs";
import type { TemplateSpec } from "api-server-api";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { ANN_AGENT_KIND } from "../../modules/agents/infrastructure/labels.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

const OWNER = "owner-1";
const ASSISTANT = "agent-00000000000000a1";
const NAME = "Dambledore";

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const existing = parseInfraAgent({
  metadata: {
    name: ASSISTANT,
    labels: { "agent-platform.ai/owner": OWNER },
    annotations: { [ANN_AGENT_KIND]: "assistant" },
  },
  spec: { name: NAME, image: "quay.io/example/agent:latest" },
});

function setup() {
  const calls = {
    storeCreate: vi.fn(async () => {
      throw new Error("the store must not be written");
    }),
    env: vi.fn(async () => undefined),
    envReplace: vi.fn(async () => undefined),
    preset: vi.fn(async () => undefined),
    presetSeedIfAbsent: vi.fn(async () => undefined),
    grants: vi.fn(async () => undefined),
    grantsIfNone: vi.fn(async () => undefined),
    storageGate: vi.fn(async () => undefined),
    getLive: vi.fn(async () => existing),
  };
  const agents = createAgentsService({
    defaultHarness: "claude-code",
    owner: OWNER,
    actor: OWNER,
    repo: unused<AgentsDeps["repo"]>({
      list: async () => [existing],
      get: async () => existing,
      getLive: calls.getLive,
      create: calls.storeCreate,
      isOwnedBy: async () => true,
    }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({
      list: async () => [],
      replace: calls.envReplace,
      insertMissing: calls.env,
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
    grantProvisioner: {
      async resolveSpecGrants() {
        return { grantedConnectionIds: ["conn-1"] };
      },
      defaultProviders: async () => ({ ids: ["conn-1"], source: "harness" }),
      applyAfterCreate: calls.grants,
      applyAfterCreateIfNone: calls.grantsIfNone,
    },
    presetSeeder: {
      seed: calls.preset,
      seedIfAbsent: calls.presetSeedIfAbsent,
    },
    storageGate: { assertCanCreateVm: calls.storageGate },
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
    assistantName: NAME,
  });
  return { agents, calls };
}

function recordEvents(): { seen: DomainEvent[]; stop: () => void } {
  const seen: DomainEvent[] = [];
  const subscription: Subscription = events$().subscribe((e) => seen.push(e));
  return { seen, stop: () => subscription.unsubscribe() };
}

describe("resuming a create", () => {
  // TEST_SCENARIO: the Agent exists already, so the store is read rather than written, and only the missing steps run: the environment variables it lacks, the egress preset when it holds no rule, the first providers when it holds none.
  it("adds what is missing and replaces nothing", async () => {
    const { agents, calls } = setup();
    await agents.create({
      id: ASSISTANT,
      name: NAME,
      kind: "assistant",
      resume: true,
      env: [{ name: "A", value: "1" }],
    });

    expect(calls.getLive).toHaveBeenCalled();
    expect(calls.storeCreate).not.toHaveBeenCalled();
    expect(calls.storageGate).not.toHaveBeenCalled();
    expect(calls.env).toHaveBeenCalledWith(ASSISTANT, [
      { name: "A", value: "1" },
    ]);
    expect(calls.envReplace).not.toHaveBeenCalled();
    expect(calls.presetSeedIfAbsent).toHaveBeenCalled();
    expect(calls.preset).not.toHaveBeenCalled();
    expect(calls.grantsIfNone).toHaveBeenCalled();
    expect(calls.grants).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the create that made the Agent announced it, so the resume announces nothing and the checklist is not unlocked twice.
  it("announces nothing", async () => {
    const events = recordEvents();
    try {
      const { agents } = setup();
      await agents.create({
        id: ASSISTANT,
        name: NAME,
        kind: "assistant",
        resume: true,
      });
      expect(events.seen.filter((e) => e.type === "AgentCreated")).toEqual([]);
    } finally {
      events.stop();
    }
  });

  // TEST_SCENARIO: a plain create still writes the store, asserts the storage gate and replaces the initialization it names.
  it("leaves a plain create as it was", async () => {
    const { agents, calls } = setup();
    await expect(
      agents.create({ name: "another", env: [{ name: "A", value: "1" }] }),
    ).rejects.toThrow("the store must not be written");
    expect(calls.storageGate).toHaveBeenCalled();
    expect(calls.env).not.toHaveBeenCalled();
  });
});

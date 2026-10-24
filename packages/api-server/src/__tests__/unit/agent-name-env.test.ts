// TEST_OVERVIEW: an agent reads its own display name from the PLATFORM_AGENT_NAME env var. The runtime state builder contributes it as a built-in env var, and a rename bumps the agent's runtime state, so the next harness spawn sees the new name without a pod roll. A save that keeps the name pushes nothing.
import { describe, expect, it, vi } from "vitest";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import {
  AGENT_NAME_ENV,
  createBuiltinContributions,
} from "../../modules/runtime-delivery/services/builtin-contributions.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const builtin = createBuiltinContributions({
  harnessServerUrl: "http://harness:4001",
  telemetryEnv: () => [],
});

const envOf = (agentName: string | null) =>
  builtin
    .for("a1", { agentName, sharedKnowledgeBases: false, harnesses: [] })
    .filter((c) => c.kind === "env");

function setup() {
  const existing = parseInfraAgent({
    metadata: {
      name: "agent-a",
      labels: { "agent-platform.ai/owner": "owner-1" },
    },
    spec: { name: "Bartholomew", image: "example.com/agent:latest" },
  });
  const bump = vi.fn(async () => 1);
  const enqueueAfterCommit = vi.fn(async () => {});
  const agents = createAgentsService({
    owner: "owner-1",
    actor: "owner-1",
    repo: unused<AgentsDeps["repo"]>({
      list: async () => [existing],
      get: async (id) => (id === existing.id ? existing : null),
      updateSpec: async (id, owner, patch) =>
        parseInfraAgent({
          metadata: {
            name: id,
            labels: { "agent-platform.ai/owner": owner ?? "owner-1" },
          },
          spec: { ...existing.spec, ...patch },
        }),
    }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({
      replace: async () => {},
      list: async () => [],
    }),
    registrySecretPort: unused(),
    secretRefs: unused(),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentIdleTimeoutMinutes: { container: 30, vm: 5 },
    cleanupHooks: [],
    readTemplateSpec: async () => null,
    runtimeMutator: unused<AgentsDeps["runtimeMutator"]>({
      bump,
      enqueueAfterCommit,
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
    editors: unused<AgentsDeps["editors"]>(),
    editorEmail: null,
    resolveUserEmail: async () => null,
  });
  return { agents, bump, enqueueAfterCommit };
}

describe("agent name env", () => {
  // TEST_SCENARIO: every harness of the agent reads the same base env layer, so the name goes there, untagged by harness, with the agent's display name as its value.
  it("contributes the display name as a base env var", () => {
    expect(envOf("Bartholomew")).toEqual([
      { kind: "env", name: AGENT_NAME_ENV, placeholder: "Bartholomew" },
    ]);
    expect(AGENT_NAME_ENV).toBe("PLATFORM_AGENT_NAME");
  });

  // TEST_SCENARIO: an agent the state builder cannot find, such as one just deleted, gets no name rather than an empty one.
  it("contributes nothing when the agent has no name", () => {
    expect(envOf(null)).toEqual([]);
  });

  // TEST_SCENARIO: a rename changes the name the state builder reads, so the agent's runtime state is bumped and queued for delivery.
  it("pushes the runtime state again after a rename", async () => {
    const { agents, bump, enqueueAfterCommit } = setup();
    await agents.update({ id: "agent-a", name: "Cedric" });
    expect(bump).toHaveBeenCalledWith("agent-a", []);
    expect(enqueueAfterCommit).toHaveBeenCalledWith("agent-a");
  });

  // TEST_SCENARIO: the settings page sends the name with every save; a save that keeps it must not push the runtime state for nothing.
  it("pushes nothing when a save keeps the name", async () => {
    const { agents, bump, enqueueAfterCommit } = setup();
    await agents.update({
      id: "agent-a",
      name: "Bartholomew",
      description: "d",
    });
    expect(bump).not.toHaveBeenCalled();
    expect(enqueueAfterCommit).not.toHaveBeenCalled();
  });
});

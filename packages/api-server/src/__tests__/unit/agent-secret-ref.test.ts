// TEST_OVERVIEW: an Agent's secretRef turns every key of the Secret it names into the agent's environment, and the name alone reaches any Secret in the agent namespace. Create and update accept one only for a Secret the agent's owner holds — their owner label, not managed by the platform — and refuse anything else before a single write, with the same answer whether the Secret is missing or someone else's.
import { describe, expect, it, vi } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { createAgentSecretRefPort } from "../../modules/agents/infrastructure/agent-secret-ref-port.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const secrets: Record<string, Record<string, string> | undefined> = {
  mine: { "agent-platform.ai/owner": "owner-1" },
  theirs: { "agent-platform.ai/owner": "owner-2" },
  unlabelled: undefined,
  credential: {
    "agent-platform.ai/owner": "owner-1",
    "agent-platform.ai/managed-by": "api-server",
  },
  runnerToken: {
    "agent-platform.ai/owner": "owner-1",
    "app.kubernetes.io/component": "vm-runner",
  },
};

function k8sWithSecrets(): K8sClient {
  return unused<K8sClient>({
    getSecret: async (name: string) =>
      name in secrets
        ? ({ metadata: { name, labels: secrets[name] } } as k8s.V1Secret)
        : null,
  });
}

function setup() {
  const persist = vi.fn(
    async (spec: Record<string, unknown>, owner: string, id: string) =>
      parseInfraAgent({
        metadata: { name: id, labels: { "agent-platform.ai/owner": owner } },
        spec,
      }),
  );
  const existing = parseInfraAgent({
    metadata: {
      name: "agent-1",
      labels: { "agent-platform.ai/owner": "owner-1" },
    },
    spec: { image: "example.com/agent:latest" },
  });
  const updateSpec = vi.fn(async () => existing);
  const agents = createAgentsService({
    owner: "owner-1",
    repo: unused<AgentsDeps["repo"]>({
      list: async () => [],
      create: persist,
      get: async (id: string) => (id === "agent-1" ? existing : null),
      updateSpec,
    }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({
      replace: async () => {},
      list: async () => [],
    }),
    registrySecretPort: unused(),
    secretRefs: createAgentSecretRefPort(k8sWithSecrets()),
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
  return { agents, persist, updateSpec };
}

const create = { name: "test-agent", image: "example.com/agent:latest" };

describe("an agent's secretRef", () => {
  // TEST_SCENARIO: a Secret carrying the creating owner's label is theirs, so the agent is created with it.
  it("is accepted for a Secret the owner holds", async () => {
    const { agents, persist } = setup();
    await agents.create({ ...create, secretRef: "mine" });
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0]![0]).toMatchObject({ secretRef: "mine" });
  });

  // TEST_SCENARIO: another owner's Secret, one with no owner at all, one that does not exist, and the platform's own credential and runner Secrets are all refused alike before the agent is written — the same message each time, so the refusal says nothing about which Secrets exist.
  it.each(["theirs", "unlabelled", "missing", "credential", "runnerToken"])(
    "is refused on create for %s",
    async (name) => {
      const { agents, persist } = setup();
      await expect(
        agents.create({ ...create, secretRef: name }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: `secretRef "${name}" does not name a Secret you own`,
      });
      expect(persist).not.toHaveBeenCalled();
    },
  );

  // TEST_SCENARIO: an update checks against the owner of the agent being changed, and a refused secretRef leaves the agent's spec untouched. Clearing the field needs no Secret at all.
  it("is checked on update against the agent's owner", async () => {
    const { agents, updateSpec } = setup();
    await expect(
      agents.update({ id: "agent-1", secretRef: "theirs" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(updateSpec).not.toHaveBeenCalled();

    await agents.update({ id: "agent-1", secretRef: "mine" });
    expect(updateSpec).toHaveBeenLastCalledWith("agent-1", "owner-1", {
      secretRef: "mine",
    });

    await agents.update({ id: "agent-1", secretRef: "" });
    expect(updateSpec).toHaveBeenLastCalledWith("agent-1", "owner-1", {
      secretRef: "",
    });
  });
});

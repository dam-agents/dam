// TEST_OVERVIEW: The assistant's name is reserved on the one create and the one rename every path goes through — the UI's, the CLI's and a starter kit's — not only on the tRPC router, and the provisioning create is the exception that may use it. A rename is judged only when it changes the name, so an update that keeps the assistant's own name passes.
import { describe, expect, it, vi } from "vitest";
import type { TemplateSpec } from "api-server-api";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { ANN_AGENT_KIND } from "../../modules/agents/infrastructure/labels.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

const OWNER = "owner-1";
const ASSISTANT_NAME = "Dambledore";
const ASSISTANT_ID = "agent-00000000000000a1";
const PLAIN_ID = "agent-00000000000000b2";

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

function infrAgent(id: string, name: string, kind?: "assistant") {
  return parseInfraAgent({
    metadata: {
      name: id,
      labels: { "agent-platform.ai/owner": OWNER },
      ...(kind ? { annotations: { [ANN_AGENT_KIND]: kind } } : {}),
    },
    spec: { name, image: "quay.io/example/agent:latest" },
  });
}

function setup(opts: { assistant?: boolean } = {}) {
  const owners = [
    ...(opts.assistant === false
      ? []
      : [infrAgent(ASSISTANT_ID, ASSISTANT_NAME, "assistant")]),
    infrAgent(PLAIN_ID, "Release helper"),
  ];
  const create = vi.fn(async () => {
    throw new Error("reached repo.create");
  });
  const updateSpec = vi.fn(async () => {
    throw new Error("reached repo.updateSpec");
  });
  const agents = createAgentsService({
    defaultHarness: "claude-code",
    owner: OWNER,
    actor: OWNER,
    repo: unused<AgentsDeps["repo"]>({
      list: async () => owners,
      get: async (id: string) => owners.find((a) => a.id === id) ?? null,
      create,
      updateSpec,
    }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({
      replace: async () => undefined,
      list: async () => [],
    }),
    registrySecretPort: unused<AgentsDeps["registrySecretPort"]>({
      create: async () => undefined,
      secretName: () => "registry",
    }),
    secretRefs: unused(),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentIdleTimeoutMinutes: 5,
    cleanupHooks: [],
    readTemplateSpec: async (id) =>
      id === "default"
        ? { spec: { image: "quay.io/example/agent:latest" } as TemplateSpec }
        : null,
    runtimeMutator: unused<AgentsDeps["runtimeMutator"]>({
      bump: async () => 1,
    }),
    contributionsProgress: unused(),
    agentServiceStatus: unused(),
    grantProvisioner: {
      async resolveSpecGrants() {
        return { grantedConnectionIds: [] };
      },
      defaultProviders: async () => ({ ids: [], source: "harness" }),
      applyAfterCreate: async () => undefined,
      applyAfterCreateIfNone: async () => undefined,
    },
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
    assistantName: ASSISTANT_NAME,
  });
  return { agents, create, updateSpec };
}

describe("the reserved assistant name on the shared create", () => {
  // TEST_SCENARIO: a create from any path — a starter kit's, the UI's, the CLI's — is refused the reserved name, and nothing is persisted.
  it("refuses another agent the assistant's name", async () => {
    const w = setup();
    await expect(w.agents.create({ name: ASSISTANT_NAME })).rejects.toThrow(
      /cannot take it/,
    );
    expect(w.create).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the provisioning create is the exception: it names itself as an assistant-kind Agent, so it may take the reserved name.
  it("lets the provisioning create take it", async () => {
    const w = setup({ assistant: false });
    await expect(
      w.agents.create({ name: ASSISTANT_NAME, kind: "assistant" }),
    ).rejects.toThrow("reached repo.create");
  });
});

describe("the reserved assistant name on a rename", () => {
  // TEST_SCENARIO: renaming the assistant is refused, and nothing is written.
  it("refuses renaming the assistant", async () => {
    const w = setup();
    await expect(
      w.agents.update({ id: ASSISTANT_ID, name: "Something else" }),
    ).rejects.toThrow(/cannot change/);
    expect(w.updateSpec).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: an update that keeps the assistant's own name is not a rename at all, so the reservation does not refuse it.
  it("lets an update keep the assistant's name", async () => {
    const w = setup();
    await expect(
      w.agents.update({ id: ASSISTANT_ID, name: ASSISTANT_NAME }),
    ).rejects.toThrow("reached repo.updateSpec");
  });

  // TEST_SCENARIO: another Agent cannot be renamed to the reserved name, and can be renamed to anything else.
  it("refuses taking the name, and no other rename", async () => {
    const w = setup();
    await expect(
      w.agents.update({ id: PLAIN_ID, name: ASSISTANT_NAME }),
    ).rejects.toThrow(/cannot take it/);
    await expect(
      w.agents.update({ id: PLAIN_ID, name: "Release helper 2" }),
    ).rejects.toThrow("reached repo.updateSpec");
  });
});

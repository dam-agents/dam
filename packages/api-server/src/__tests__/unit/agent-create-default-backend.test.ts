// TEST_OVERVIEW: every agent created on an install that can run microVMs is a
// TEST_OVERVIEW: microVM, and a container agent cannot be created there at all:
// TEST_OVERVIEW: every create path — the UI's forms, a starter kit, a sub-agent
// TEST_OVERVIEW: spawn, the CLI and the API — ends in the one agents create, so
// TEST_OVERVIEW: both rules are applied there rather than trusted to each caller.
// TEST_OVERVIEW: An install without virtualization keeps creating containers, which
// TEST_OVERVIEW: is what a local or dev install without a hypervisor is.
import { describe, expect, it } from "vitest";
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

async function createdBackend(
  virtualizationEnabled: boolean,
  vm?: boolean,
): Promise<unknown> {
  const specs: Record<string, unknown>[] = [];
  const agents = createAgentsService({
    owner: "owner-1",
    virtualizationEnabled,
    repo: unused<AgentsDeps["repo"]>({
      list: async () => [],
      create: async (spec, owner, id) => {
        specs.push(spec);
        return parseInfraAgent({
          metadata: { name: id, labels: { "agent-platform.ai/owner": owner } },
          spec,
        });
      },
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
  await agents.create({
    name: "test-agent",
    image: "example.com/agent:latest",
    ...(vm === undefined ? {} : { vm }),
  });
  return specs[0]!.backend;
}

describe("the backend a create lands on", () => {
  // TEST_SCENARIO: a starter kit that declares no backend, like Plain wiki, and a sub-agent spawn both send no vm; on an install that can virtualize they still land on a machine.
  it("is a microVM on an install that can virtualize, asked for or not", async () => {
    expect(await createdBackend(true)).toEqual({ type: "vm" });
    expect(await createdBackend(true, true)).toEqual({ type: "vm" });
  });

  // TEST_SCENARIO: an install with virtualization off has no machine to put an agent on, so a create lands on a container and an explicit request for a microVM is refused rather than quietly downgraded.
  it("follows the caller on an install that cannot virtualize", async () => {
    expect(await createdBackend(false)).toBeUndefined();
    await expect(createdBackend(false, true)).rejects.toThrow(
      /virtualization\.enabled/,
    );
  });

  // TEST_SCENARIO: a container agent cannot be made on an install that can virtualize, however it is asked for: the stateful set, the claims and the pod are the legacy path, kept only for the agents made before the switch. The refusal names the one runtime such an install still creates.
  it("refuses a container on an install that can virtualize", async () => {
    await expect(createdBackend(true, false)).rejects.toThrow(
      /runs every new agent as its own microVM/,
    );
  });
});

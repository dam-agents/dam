// TEST_OVERVIEW: an install that pins the new sandbox runtime on creates every agent as a microVM, whatever the caller asked for. Every create path — the UI's forms, a starter kit, a sub-agent spawn, the CLI and the API — ends in the one agents create, so the pin is applied there rather than trusted to each caller.
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
  vmForced: boolean,
  vm?: boolean,
): Promise<unknown> {
  const specs: Record<string, unknown>[] = [];
  const agents = createAgentsService({
    owner: "owner-1",
    vmForced,
    virtualizationEnabled: true,
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
    agentDefaultMounts: [],
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

describe("a create on an install that pins the vm runtime", () => {
  // TEST_SCENARIO: a starter kit that declares no backend, like Plain wiki, sends no vm; the pin still makes it a microVM.
  it("is a microVM although the caller asked for none", async () => {
    expect(await createdBackend(true)).toEqual({ type: "vm" });
    expect(await createdBackend(true, false)).toEqual({ type: "vm" });
  });

  // TEST_SCENARIO: without the pin, the caller's choice decides, as before.
  it("follows the caller without the pin", async () => {
    expect(await createdBackend(false)).toBeUndefined();
    expect(await createdBackend(false, true)).toEqual({ type: "vm" });
  });
});

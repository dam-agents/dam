// TEST_OVERVIEW: which Backend a new Agent is created on. The install sets a default (AGENT_DEFAULT_BACKEND), an explicit `vm` on the create input wins over it, and a template that needs a pod keeps its agents on containers: it falls back to a container under a vm default, and an explicit vm is refused with the reason. Invocation targets are created through the same create, so they follow the same rule.
import {
  type AgentBackend,
  containerOnlyReason,
  type TemplateSpec,
} from "api-server-api";
import { describe, expect, it, vi } from "vitest";

import { resolveBackend } from "../../modules/agents/domain/backend-resolution.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import type { InvocationsRepository } from "../../modules/invocations/infrastructure/invocations-repository.js";
import { createInvocationsService } from "../../modules/invocations/services/invocations-service.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const plain: TemplateSpec = {
  version: "agent-platform.ai/v1",
  image: "quay.io/example/claude-code:1",
  mounts: [{ path: "/home/agent", persist: true }],
};

const gpu: TemplateSpec = {
  ...plain,
  runtimeClassName: "nvidia",
  resources: { limits: { "nvidia.com/gpu": "1" } },
};

const templates: Record<string, TemplateSpec> = { plain, gpu };

function setup(opts: {
  virtualizationEnabled: boolean;
  defaultBackend: AgentBackend;
}) {
  const persist = vi.fn(
    async (spec: Record<string, unknown>, owner: string, id: string) =>
      parseInfraAgent({
        metadata: { name: id, labels: { "agent-platform.ai/owner": owner } },
        spec,
      }),
  );
  const agents = createAgentsService({
    owner: "owner-1",
    repo: unused<AgentsDeps["repo"]>({ create: persist }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({
      replace: async () => {},
    }),
    registrySecretPort: unused(),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentIdleTimeoutMinutes: 30,
    virtualizationEnabled: opts.virtualizationEnabled,
    defaultBackend: opts.defaultBackend,
    cleanupHooks: [],
    readTemplateSpec: async (id) => {
      const spec = templates[id];
      return spec ? { spec } : null;
    },
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
  const backendOf = (call: number) =>
    (persist.mock.calls[call]?.[0] as { backend?: { type: string } }).backend
      ?.type ?? "container";
  return { agents, persist, backendOf };
}

const vmDefault = {
  virtualizationEnabled: true,
  defaultBackend: "vm",
} as const;

describe("resolveBackend", () => {
  it.each([
    [undefined, "container", undefined, "container"],
    [undefined, "vm", undefined, "vm"],
    [undefined, "vm", "needs a GPU", "container"],
    [false, "vm", undefined, "container"],
    [true, "container", undefined, "vm"],
    [false, "vm", "needs a GPU", "container"],
  ] as const)(
    "requested %s, install default %s, container-only %s → %s",
    (requestedVm, installDefault, containerOnlyReason, expected) => {
      expect(
        resolveBackend({ requestedVm, installDefault, containerOnlyReason }),
      ).toEqual({ kind: "resolved", backend: expected });
    },
  );

  // TEST_SCENARIO: an explicit vm request for a template that needs a pod is a choice the platform cannot honour, so it must be refused with the reason rather than quietly turned into a container.
  it("refuses an explicit vm for a container-only template", () => {
    expect(
      resolveBackend({
        requestedVm: true,
        installDefault: "vm",
        containerOnlyReason: "needs a GPU",
      }),
    ).toEqual({ kind: "refused", reason: "needs a GPU" });
  });
});

describe("agents.create — install default backend", () => {
  // TEST_SCENARIO: the whole point of the install default — a create that names no backend, from the API or a kit, lands on a machine once the operator switched the install to vm.
  it("creates a microVM when the create names no backend and the install defaults to vm", async () => {
    const { agents, backendOf } = setup(vmDefault);
    await agents.create({ name: "a", templateId: "plain" });
    await agents.create({ name: "b", image: "quay.io/example/own:1" });
    expect(backendOf(0)).toBe("vm");
    expect(backendOf(1)).toBe("vm");
  });

  it("keeps a container when the install default is container", async () => {
    const { agents, backendOf } = setup({
      virtualizationEnabled: true,
      defaultBackend: "container",
    });
    await agents.create({ name: "a", templateId: "plain" });
    expect(backendOf(0)).toBe("container");
  });

  // TEST_SCENARIO: a caller that says `vm: false` saw the choice and made it, so the install default must not override it.
  it("lets an explicit container win over a vm default", async () => {
    const { agents, backendOf } = setup(vmDefault);
    await agents.create({ name: "a", templateId: "plain", vm: false });
    expect(backendOf(0)).toBe("container");
  });

  // TEST_SCENARIO: a GPU template selects a container runtime and asks the kubelet for a device, neither of which a machine has. Under a vm default it must still produce a working agent, so it falls back to a container with its placement intact.
  it("keeps a container-only template on a container under a vm default", async () => {
    const { agents, persist, backendOf } = setup(vmDefault);
    await agents.create({ name: "a", templateId: "gpu" });
    expect(backendOf(0)).toBe("container");
    expect(persist.mock.calls[0]?.[0]).toMatchObject({
      runtimeClassName: "nvidia",
    });
  });

  it("refuses an explicit vm on a container-only template, naming why", async () => {
    const { agents, persist } = setup(vmDefault);
    await expect(
      agents.create({ name: "a", templateId: "gpu", vm: true }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining('container runtime "nvidia"'),
    });
    expect(persist).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the chart and the config both refuse a vm default without virtualization, but should one reach the service anyway it must not produce agents the controller parks; a create that names no backend stays a container there.
  it("never defaults to vm on an install without virtualization", async () => {
    const { agents, backendOf } = setup({
      virtualizationEnabled: false,
      defaultBackend: "vm",
    });
    await agents.create({ name: "a", templateId: "plain" });
    expect(backendOf(0)).toBe("container");
  });

  it("still refuses an explicit vm on an install without virtualization", async () => {
    const { agents } = setup({
      virtualizationEnabled: false,
      defaultBackend: "container",
    });
    await expect(
      agents.create({ name: "a", templateId: "plain", vm: true }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("invocation targets follow the install default", () => {
  function spawnVia(agents: ReturnType<typeof setup>["agents"]) {
    const repo = unused<InvocationsRepository>({
      insert: async () => {},
      delete: async () => {},
    });
    return createInvocationsService({
      owner: "owner-1",
      repo,
      agents,
      driverResolution: { resolveRoot: async () => "root-agent" },
      runtimeMutator: {
        bump: async () => 0,
        enqueueAfterCommit: async () => {},
      } as never,
      wakeAgent: async () => {},
    });
  }
  const spawnInput = {
    driverAgentId: "driver-1",
    driverGrantIds: [],
    connections: [],
    prompt: "do the thing",
    schema: { type: "object" },
  };

  // TEST_SCENARIO: a target is an ordinary Agent created for one task, so an install that runs every new agent as a machine runs its targets as machines too, and a GPU template's target stays a container for the same reason a GPU agent does.
  it("spawns a target on vm, or on a container when its template needs one", async () => {
    const { agents, backendOf } = setup(vmDefault);
    const invocations = spawnVia(agents);
    await invocations.spawn({ ...spawnInput, templateId: "plain" });
    await invocations.spawn({ ...spawnInput, templateId: "gpu" });
    expect(backendOf(0)).toBe("vm");
    expect(backendOf(1)).toBe("container");
  });
});

describe("containerOnlyReason", () => {
  it("lets a template that persists only HOME run on a machine", () => {
    expect(
      containerOnlyReason({
        mounts: [
          { path: "/home/agent", persist: true },
          { path: "/home/agent/.cache", persist: true },
          { path: "/tmp", persist: false },
        ],
        resources: { limits: { cpu: "2", memory: "4Gi" } },
      }),
    ).toBeUndefined();
  });

  it.each([
    [{ requiresContainer: true }, "runs only as a container"],
    [{ runtimeClassName: "kata" }, 'container runtime "kata"'],
    [{ nodeSelector: { pool: "gpu" } }, "selected nodes"],
    [{ resources: { requests: { "nvidia.com/gpu": "1" } } }, "nvidia.com/gpu"],
    [{ mounts: [{ path: "/opt/tools", persist: true }] }, "/opt/tools"],
  ])("keeps %o on a container", (spec, reason) => {
    expect(containerOnlyReason(spec)).toContain(reason);
  });
});

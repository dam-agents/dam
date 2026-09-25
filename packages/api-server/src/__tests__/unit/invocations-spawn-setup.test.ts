import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import { mountInvocationRoutes } from "../../apps/harness-api-server/invocation-endpoints.js";
import { AGENTS_PLURAL } from "../../modules/agents/infrastructure/labels.js";
import type { InvocationsRepository } from "../../modules/invocations/infrastructure/invocations-repository.js";
import {
  createInvocationsService,
  ProviderMismatchError,
  type SpawnInput,
} from "../../modules/invocations/services/invocations-service.js";
import { createSetupFailure } from "../../modules/invocations/services/setup-failure.js";
import { inheritProvider } from "../../modules/invocations/domain/provider-inheritance.js";

// TEST_OVERVIEW: A spawn sets up its sub-agent the way a starter kit sets up an agent. The endpoint resolves the harness to its Template, or runs a given image instead, and collects the driver's provider grants; the service turns the Agent Setup into the create, queues the install ahead of the task, and gives the target the driver's provider. A failed seed or install fails the Invocation at once.

function repoStub(overrides: Partial<InvocationsRepository> = {}) {
  const failed: Array<[string, string]> = [];
  const repo: InvocationsRepository = {
    insert: async () => {},
    get: async () => null,
    complete: async () => true,
    fail: async (id, reason) => {
      failed.push([id, reason]);
    },
    listExpiredRunning: async () => [],
    listRunning: async () => [],
    listRunningByDriver: async () => [],
    listRunningDriverIds: async () => [],
    listRunningAgentIds: async () => [],
    listTargetsByOwner: async () => [],
    listAgedTerminal: async () => [],
    listByExperiment: async () => [],
    countRunningByDriver: async () => new Map(),
    failAllRunningByExperiment: async () => [],
    delete: async () => {},
    ...overrides,
  };
  return { repo, failed };
}

function makeService() {
  const created: Array<Record<string, unknown>> = [];
  const bumped: Array<Array<{ id: string; kind: string; payload: unknown }>> =
    [];
  const skillsApplied: unknown[] = [];
  const pinned: string[] = [];
  const service = createInvocationsService({
    owner: "owner-1",
    repo: repoStub().repo,
    agents: {
      create: async (input: Record<string, unknown>) => {
        created.push(input);
        return { id: input.id as string };
      },
      delete: async () => {},
    } as never,
    driverResolution: { resolveRoot: async () => "root-1" },
    runtimeMutator: {
      bump: async (_id: string, events: never) => {
        bumped.push(events);
        return 0;
      },
      enqueueAfterCommit: async () => {},
    } as never,
    wakeAgent: async () => {},
    skills: {
      applyEntries: async (input) => {
        skillsApplied.push(input);
        return { installed: [], skipped: [], added: 0 } as never;
      },
    },
    pinDriver: async (id) => {
      pinned.push(id);
    },
  });
  return { service, created, bumped, skillsApplied, pinned };
}

const baseInput: SpawnInput = {
  driverAgentId: "driver-1",
  driverGrantIds: ["conn-ghe", "conn-litellm"],
  driverProviders: [{ id: "conn-litellm", type: "ibm-litellm" }],
  target: { templateId: "claude-code", runsOn: ["ibm-litellm", "anthropic"] },
  setup: { env: [], skills: [] },
  connections: ["conn-ghe"],
  prompt: "run one cell",
  schema: { type: "object" },
};

describe("spawn applies an Agent Setup", () => {
  // TEST_SCENARIO: the seed, backend, size, disk and env a kit would pass to the create reach the target's create unchanged, and the target keeps its minted name so spend views still recognise it once it is gone.
  test("the setup reaches the target's create", async () => {
    const { service, created } = makeService();

    await service.spawn({
      ...baseInput,
      setup: {
        seed: {
          url: "https://github.example/acme/tool",
          commit: "a".repeat(40),
          into: "work",
        },
        backend: "vm",
        resources: { cpu: "2", memory: "4Gi", storage: "10Gi" },
        env: [{ name: "MODE", value: "cell" }],
        skills: [],
      },
    });

    expect(created[0]).toMatchObject({
      templateId: "claude-code",
      gitRepo: {
        url: "https://github.example/acme/tool",
        commit: "a".repeat(40),
        into: "work",
      },
      vm: true,
      size: { cpu: "2", memory: "4Gi" },
      storage: "10Gi",
      env: [{ name: "MODE", value: "cell" }],
      connectionIds: ["conn-ghe"],
    });
    expect(String(created[0]?.name)).toMatch(/^invocation-[0-9a-f]{12}$/);
  });

  // TEST_SCENARIO: the install must run before the task, so it is queued in the same bump and ahead of the trigger event.
  test("the install is queued ahead of the task", async () => {
    const { service, bumped } = makeService();

    await service.spawn({
      ...baseInput,
      setup: { install: { command: "uv pip install ." }, env: [], skills: [] },
    });

    expect(bumped[0]?.map((e) => e.kind)).toEqual([
      "workspace-command",
      "trigger",
    ]);
    expect(bumped[0]?.[0]?.payload).toEqual({ command: "uv pip install ." });
  });

  test("without an install only the task is queued", async () => {
    const { service, bumped } = makeService();

    await service.spawn(baseInput);

    expect(bumped[0]?.map((e) => e.kind)).toEqual(["trigger"]);
  });

  test("external skills are applied to the target", async () => {
    const { service, skillsApplied } = makeService();
    const skills = [
      { source: "https://github.example/acme/skills", name: "x" },
    ];

    const { id } = await service.spawn({
      ...baseInput,
      setup: { env: [], skills },
    });

    expect(skillsApplied).toEqual([{ agentId: id, skills }]);
  });

  // TEST_SCENARIO: the label a driver passes names the sub-agent, so it is minted into the target's name; the name still carries the entropy and the prefix the recognizer reads.
  test("a label names the target", async () => {
    const { service, created } = makeService();

    await service.spawn({ ...baseInput, label: "Summarize README" });

    expect(String(created[0]?.name)).toMatch(
      /^invocation-summarize-readme-[0-9a-f]{12}$/,
    );
  });
});

function makeFailingSkillsService(
  applyEntries: (input: {
    agentId: string;
    skills: unknown[];
  }) => Promise<unknown>,
) {
  const { repo, failed } = repoStub({
    get: async () =>
      ({ id: "agent-1", owner: "owner-1", status: "running" }) as never,
  });
  const deleted: string[] = [];
  const service = createInvocationsService({
    owner: "owner-1",
    repo,
    agents: {
      create: async (input: Record<string, unknown>) => ({
        id: input.id as string,
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    } as never,
    driverResolution: { resolveRoot: async () => "root-1" },
    runtimeMutator: {
      bump: async () => 0,
      enqueueAfterCommit: async () => {},
    } as never,
    wakeAgent: async () => {},
    skills: { applyEntries } as never,
  });
  return { service, failed, deleted };
}

const withSkills: SpawnInput = {
  ...baseInput,
  setup: {
    env: [],
    skills: [{ source: "https://github.example/acme/skills", name: "triage" }],
  },
};

describe("a skills apply that does not land fails the Invocation", () => {
  // TEST_SCENARIO: a declared skill the target never received is a setup step that did not happen. The driver is polling and would otherwise read a success whose turn ran without the skill, so the Invocation fails with the reason and the target is deleted, exactly as a failed seed or install does.
  test("an apply that raises fails the Invocation and deletes the target", async () => {
    const { service, failed, deleted } = makeFailingSkillsService(async () => {
      throw new Error("agent never became reachable");
    });

    const { id } = await service.spawn(withSkills);

    expect(failed).toEqual([
      [id, "skills failed: agent never became reachable"],
    ]);
    expect(deleted).toEqual([id]);
  });

  // TEST_SCENARIO: a skipped skill raises nothing — the apply reports which entries it left out, and why. That list is the reason the driver gets.
  test("a skipped skill fails the Invocation with its reason", async () => {
    const { service, failed } = makeFailingSkillsService(async () => ({
      installed: [],
      added: 0,
      skipped: [
        {
          source: "https://github.example/acme/skills",
          name: "triage",
          reason: "source-not-connected",
        },
      ],
    }));

    const { id } = await service.spawn(withSkills);

    expect(failed).toEqual([
      [id, "skills failed: triage (source-not-connected)"],
    ]);
  });

  test("an apply that installs everything fails nothing", async () => {
    const { service, failed, deleted } = makeFailingSkillsService(async () => ({
      installed: [
        { source: "https://github.example/acme/skills", name: "triage" },
      ],
      added: 1,
      skipped: [],
    }));

    await service.spawn(withSkills);

    expect(failed).toEqual([]);
    expect(deleted).toEqual([]);
  });
});

describe("spawn pins its driver", () => {
  // TEST_SCENARIO: the driver must not hibernate between its spawn call and the next pin reconcile, so the spawn itself pins it before the target is created.
  test("the driver is pinned before the target is created", async () => {
    const { service, pinned, created } = makeService();

    await service.spawn(baseInput);

    expect(pinned).toEqual(["driver-1"]);
    expect(created).toHaveLength(1);
  });

  test("a refused spawn does not pin", async () => {
    const { service, pinned } = makeService();

    await expect(
      service.spawn({
        ...baseInput,
        target: { templateId: "codex", runsOn: ["openai"] },
      }),
    ).rejects.toBeInstanceOf(ProviderMismatchError);
    expect(pinned).toEqual([]);
  });
});

describe("spawn inherits the driver's provider", () => {
  test("the target runs on the driver's provider grant", async () => {
    const { service, created } = makeService();

    await service.spawn(baseInput);

    expect(created[0]).toMatchObject({ providerConnectionId: "conn-litellm" });
  });

  // TEST_SCENARIO: a target whose Template cannot run on any of the driver's providers would fail its first model call, so the spawn is refused before anything is created.
  test("a target that cannot run on the driver's provider is refused", async () => {
    const { service, created } = makeService();

    await expect(
      service.spawn({
        ...baseInput,
        target: { templateId: "codex", runsOn: ["openai"] },
      }),
    ).rejects.toBeInstanceOf(ProviderMismatchError);
    expect(created).toEqual([]);
  });

  test("the first compatible provider is picked", () => {
    expect(
      inheritProvider(
        [
          { id: "a", type: "anthropic" },
          { id: "b", type: "openai" },
        ],
        ["openai"],
      ),
    ).toEqual({ kind: "inherited", id: "b" });
  });

  test("a driver without a provider spawns without one", () => {
    expect(inheritProvider([], ["openai"])).toEqual({ kind: "none" });
  });

  test("an image target narrows nothing", () => {
    expect(
      inheritProvider([{ id: "a", type: "anthropic" }], undefined),
    ).toEqual({ kind: "inherited", id: "a" });
  });
});

describe("a failed seed or install fails the Invocation", () => {
  // TEST_SCENARIO: the driver is polling and the target will never start, so the Invocation fails at once with the step and its reason, and the target is deleted.
  test("a running target fails with the step's reason and is deleted", async () => {
    const { repo, failed } = repoStub({
      get: async () =>
        ({ id: "agent-1", owner: "owner-1", status: "running" }) as never,
    });
    const deleted: string[] = [];
    const fail = createSetupFailure({
      repo,
      agentsFor: () => ({
        delete: async (id: string) => {
          deleted.push(id);
        },
      }),
    });

    await fail("agent-1", "install", "exit 1: no matching distribution");

    expect(failed).toEqual([
      ["agent-1", "install failed: exit 1: no matching distribution"],
    ]);
    expect(deleted).toEqual(["agent-1"]);
  });

  test("an agent that is not a running target is left alone", async () => {
    const { repo, failed } = repoStub();
    const deleted: string[] = [];
    const fail = createSetupFailure({
      repo,
      agentsFor: () => ({
        delete: async (id: string) => {
          deleted.push(id);
        },
      }),
    });

    await fail(
      "agent-1",
      "seed",
      "refusing to seed a non-empty work directory",
    );

    expect(failed).toEqual([]);
    expect(deleted).toEqual([]);
  });
});

function makeApp(templates: Array<{ id: string; spec: object }>) {
  const spawned: Array<Record<string, unknown>> = [];
  const app = new Hono();
  mountInvocationRoutes(app, {
    k8s: {
      getCustomObject: async (plural: string, id: string) =>
        plural === AGENTS_PLURAL && id === "driver-1"
          ? {
              metadata: {
                uid: "uid-1",
                labels: { "agent-platform.ai/owner": "owner-1" },
              },
              spec: {},
            }
          : null,
    } as never,
    invocationsServiceFor: () =>
      ({
        spawn: async (input: Record<string, unknown>) => {
          spawned.push(input);
          return { id: "target-1" };
        },
      }) as never,
    connectionsServiceFor: () =>
      ({
        listConnections: async () => [
          { id: "conn-litellm", templateId: "ibm-litellm" },
          { id: "conn-ghe", templateId: "github-enterprise-oauth" },
          { id: "conn-other", templateId: "anthropic" },
        ],
        getAgentConnections: async () => ({
          connections: [
            { connectionId: "conn-litellm" },
            { connectionId: "conn-ghe" },
          ],
        }),
      }) as never,
    templates: { list: async () => templates, get: async () => null } as never,
    budgetsFor: () => ({}) as never,
    defaultLimits: { cpu: "1", memory: "1Gi" },
  });
  return { app, spawned };
}

const post = (body: object) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: "go", schema: { type: "object" }, ...body }),
});

describe("the spawn endpoint", () => {
  const catalog = [
    {
      id: "claude-code",
      spec: { harness: "claude-code", providers: ["ibm-litellm", "anthropic"] },
    },
    { id: "codex", spec: { harness: "codex", providers: ["openai"] } },
  ];

  test("a harness runs on its Template, with the providers it can run on", async () => {
    const { app, spawned } = makeApp(catalog);

    const res = await app.request(
      "/api/agents/driver-1/invocations",
      post({ harness: "claude-code" }),
    );

    expect(res.status).toBe(201);
    expect(spawned[0]).toMatchObject({
      target: {
        templateId: "claude-code",
        runsOn: ["ibm-litellm", "anthropic"],
      },
    });
  });

  // TEST_SCENARIO: an image runs in place of the harness's Template, the way a kit with its own image is created; the harness still says which providers that image can run on.
  test("an image replaces the Template and keeps the harness's providers", async () => {
    const { app, spawned } = makeApp(catalog);

    await app.request(
      "/api/agents/driver-1/invocations",
      post({ harness: "codex", image: "registry.example/worker:1" }),
    );

    expect(spawned[0]?.target).toEqual({
      image: "registry.example/worker:1",
      runsOn: ["openai"],
    });
  });

  test("a label reaches the spawn", async () => {
    const { app, spawned } = makeApp(catalog);

    await app.request(
      "/api/agents/driver-1/invocations",
      post({ harness: "claude-code", label: "summarize-readme" }),
    );

    expect(spawned[0]).toMatchObject({ label: "summarize-readme" });
  });

  test("an image alone narrows nothing", async () => {
    const { app, spawned } = makeApp(catalog);

    await app.request(
      "/api/agents/driver-1/invocations",
      post({ image: "registry.example/worker:1" }),
    );

    expect(spawned[0]?.target).toEqual({ image: "registry.example/worker:1" });
  });

  test("a harness with several Templates is refused", async () => {
    const { app } = makeApp([
      ...catalog,
      { id: "claude-code-next", spec: { harness: "claude-code" } },
    ]);

    const res = await app.request(
      "/api/agents/driver-1/invocations",
      post({ harness: "claude-code" }),
    );

    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("several templates");
  });

  test("a spawn naming neither a harness nor an image is refused", async () => {
    const { app, spawned } = makeApp(catalog);

    const res = await app.request(
      "/api/agents/driver-1/invocations",
      post({ templateId: "claude-code" }),
    );

    expect(res.status).toBe(400);
    expect(spawned).toEqual([]);
  });

  // TEST_SCENARIO: only the driver's own provider grants are candidates for the target; a provider the owner holds but never granted to the driver is not.
  test("the driver's provider grants are collected, and nothing else", async () => {
    const { app, spawned } = makeApp(catalog);

    await app.request(
      "/api/agents/driver-1/invocations",
      post({ harness: "claude-code" }),
    );

    expect(spawned[0]?.driverProviders).toEqual([
      { id: "conn-litellm", type: "ibm-litellm" },
    ]);
  });

  // TEST_SCENARIO: agent images pinned to an older platform-base still send cpu and memory beside the setup; they arrive as the setup's resources.
  test("the older cpu and memory fields become the setup's resources", async () => {
    const { app, spawned } = makeApp(catalog);

    await app.request(
      "/api/agents/driver-1/invocations",
      post({ harness: "claude-code", cpu: "2", memory: "4Gi" }),
    );

    expect(spawned[0]).toMatchObject({
      setup: { resources: { cpu: "2", memory: "4Gi" } },
    });
  });

  test("the setup passes through", async () => {
    const { app, spawned } = makeApp(catalog);

    await app.request(
      "/api/agents/driver-1/invocations",
      post({
        harness: "claude-code",
        seed: { url: "https://github.example/acme/tool", ref: "main" },
        install: { command: "make" },
        env: [{ name: "A", value: "1" }],
      }),
    );

    expect(spawned[0]).toMatchObject({
      setup: {
        seed: {
          url: "https://github.example/acme/tool",
          ref: "main",
          into: "work",
        },
        install: { command: "make" },
        env: [{ name: "A", value: "1" }],
        skills: [],
      },
    });
  });
});

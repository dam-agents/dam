// TEST_OVERVIEW: A create records each initialization step as it lands, and a later create skips the recorded ones. That is what keeps a retry from restoring what the owner changed in between: choosing no network access, or detaching every provider, empties a set that an "apply if absent" step would read as unfinished. The adapters are the real ones — the preset seeder and the connection-grant provisioner — so the test sees the rules and grants a user would.
import { describe, expect, it, vi } from "vitest";
import type { AgentInitStep, TemplateSpec } from "api-server-api";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { connectionGrantProvisioner } from "../../modules/agents/compose.js";
import { createPresetSeeder } from "../../modules/egress-rules/services/preset-seeder.js";
import type { EgressRulesRepository } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";
import { ANN_AGENT_KIND } from "../../modules/agents/infrastructure/labels.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

const OWNER = "owner-1";
const ASSISTANT = "agent-00000000000000a1";
const NAME = "Dambledore";
const PROVIDER = "conn-provider";

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

/** UNIT_BOUNDARY_DESCRIPTION: the egress rules table, as the real seeder and its repository see it — `revokePresetRowsForAgent` clears what the assistant holds, and only active rows are listed. */
function egressWorld() {
  let active: { host: string; source: string }[] = [];
  const seeder = createPresetSeeder({
    repo: unused<EgressRulesRepository>({
      revokePresetRowsForAgent: async () => {
        active = [];
      },
      insert: async (row) => {
        active.push({ host: row.host, source: row.source ?? "" });
        return { ...row } as never;
      },
      insertAll: async (rows) => {
        for (const row of rows)
          active.push({ host: row.host, source: row.source ?? "" });
      },
      markPresetUnderConnections: async () => undefined,
      listForAgent: async () => active as never,
    }),
    trustedHosts: ["github.com"],
  });
  return {
    seeder: {
      seed: vi.fn(seeder.seed),
      seedIfAbsent: vi.fn(seeder.seedIfAbsent),
    },
    get active() {
      return active;
    },
    /** UNIT_BOUNDARY_DESCRIPTION: the owner choosing no network access, through the same seeder the app uses. */
    ownerSelectsNone: () => seeder.seed(ASSISTANT, "none", OWNER),
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: the grant table, as the real provisioner reads and writes it. */
function grantsWorld() {
  let held: string[] = [];
  const provisioner = connectionGrantProvisioner(
    unused<Parameters<typeof connectionGrantProvisioner>[0]>({
      getAgentConnections: async () =>
        ({
          connections: held.map((id) => ({ connectionId: id })),
        }) as never,
      setAgentConnections: async (_agentId: string, ids: string[]) => {
        held = [...ids];
      },
    }),
    { harnesses: [] },
  );
  return {
    provisioner: {
      ...provisioner,
      applyAfterCreate: vi.fn(provisioner.applyAfterCreate),
      applyAfterCreateIfNone: vi.fn(provisioner.applyAfterCreateIfNone),
    },
    get held() {
      return held;
    },
    ownerDetaches: () => {
      held = [];
    },
  };
}

function createAgent(deps: {
  seeder: ReturnType<typeof egressWorld>["seeder"];
  provisioner: ReturnType<typeof grantsWorld>["provisioner"];
  onInitStep: (step: AgentInitStep) => Promise<void>;
  failGrants?: () => boolean;
}) {
  return createAgentsService({
    defaultHarness: "claude-code",
    owner: OWNER,
    actor: OWNER,
    repo: unused<AgentsDeps["repo"]>({
      list: async () => [existing],
      get: async () => existing,
      getLive: async () => existing,
      create: async () => existing,
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
    grantProvisioner: {
      ...deps.provisioner,
      async applyAfterCreate(agentId, sel) {
        if (deps.failGrants?.() === true)
          throw new Error("the grant step failed");
        await deps.provisioner.applyAfterCreate(agentId, sel);
      },
      defaultProviders: async () => ({ ids: [PROVIDER], source: "harness" }),
      async resolveSpecGrants() {
        return { grantedConnectionIds: [PROVIDER] };
      },
    },
    presetSeeder: deps.seeder,
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
    assistantName: NAME,
  });
}

/** UNIT_BOUNDARY_DESCRIPTION: the steps a create records, as the assistants row would hold them. */
function recordingSteps() {
  const done: AgentInitStep[] = [];
  return {
    done,
    onInitStep: async (step: AgentInitStep) => {
      if (!done.includes(step)) done.push(step);
    },
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: the first create of the Agent, before anything has landed. */
const fresh = (onInitStep: (step: AgentInitStep) => Promise<void>) => ({
  id: ASSISTANT,
  name: NAME,
  kind: "assistant" as const,
  initDone: [] as AgentInitStep[],
  onInitStep,
});

/** UNIT_BOUNDARY_DESCRIPTION: what a resumed create is told, as the assistants row would hold it. */
const resumedWith = (
  steps: AgentInitStep[],
  onInitStep: (step: AgentInitStep) => Promise<void>,
) => ({
  id: ASSISTANT,
  name: NAME,
  kind: "assistant" as const,
  resume: true,
  initDone: steps,
  onInitStep,
});

describe("resuming a create that already initialized", () => {
  // TEST_SCENARIO: the egress step landed, then the owner chose no network access, then a retry arrives. The recorded step is skipped, so the owner's empty rule set stands.
  it("does not restore egress the owner closed", async () => {
    const egress = egressWorld();
    const grants = grantsWorld();
    const steps = recordingSteps();
    const agents = createAgent({
      seeder: egress.seeder,
      provisioner: grants.provisioner,
      onInitStep: steps.onInitStep,
    });

    await agents.create(fresh(steps.onInitStep));
    expect(egress.active).toEqual([
      { host: "github.com", source: "preset:trusted" },
    ]);
    expect(steps.done).toEqual(["env", "egress", "grants"]);

    await egress.ownerSelectsNone();
    expect(egress.active).toEqual([]);

    await agents.create(resumedWith(steps.done, steps.onInitStep));
    expect(egress.active).toEqual([]);
    expect(egress.seeder.seedIfAbsent).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the grant step landed, then the owner detached every provider, then a retry arrives. The recorded step is skipped, so nothing is granted again.
  it("does not re-grant a provider the owner detached", async () => {
    const egress = egressWorld();
    const grants = grantsWorld();
    const steps = recordingSteps();
    const agents = createAgent({
      seeder: egress.seeder,
      provisioner: grants.provisioner,
      onInitStep: steps.onInitStep,
    });

    await agents.create(fresh(steps.onInitStep));
    expect(grants.held).toEqual([PROVIDER]);

    grants.ownerDetaches();
    await agents.create(resumedWith(steps.done, steps.onInitStep));
    expect(grants.held).toEqual([]);
    expect(grants.provisioner.applyAfterCreateIfNone).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a create that failed at the grant step leaves the steps before it recorded, and the retry applies only the grant step — the egress seeder is not asked again.
  it("finishes only the steps that never landed", async () => {
    const egress = egressWorld();
    const grants = grantsWorld();
    const steps = recordingSteps();
    let failGrants = true;
    const agents = createAgent({
      seeder: egress.seeder,
      provisioner: grants.provisioner,
      onInitStep: steps.onInitStep,
      failGrants: () => failGrants,
    });

    await expect(agents.create(fresh(steps.onInitStep))).rejects.toThrow(
      "the grant step failed",
    );
    expect(steps.done).toEqual(["env", "egress"]);
    expect(grants.held).toEqual([]);

    failGrants = false;
    await agents.create(resumedWith(steps.done, steps.onInitStep));
    expect(steps.done).toEqual(["env", "egress", "grants"]);
    expect(grants.held).toEqual([PROVIDER]);
    expect(egress.active).toEqual([
      { host: "github.com", source: "preset:trusted" },
    ]);
  });

  // TEST_SCENARIO: a step the caller says is done is not run at all — not even its "apply if absent" form — so the safest reading of an empty set is never taken.
  it("does not ask the seeder at all for a recorded step", async () => {
    const egress = egressWorld();
    const grants = grantsWorld();
    const steps = recordingSteps();
    const agents = createAgent({
      seeder: egress.seeder,
      provisioner: grants.provisioner,
      onInitStep: steps.onInitStep,
    });
    await egress.ownerSelectsNone();

    await agents.create(
      resumedWith(["env", "egress", "grants"], steps.onInitStep),
    );
    expect(egress.active).toEqual([]);
    expect(grants.held).toEqual([]);
    expect(egress.seeder.seedIfAbsent).not.toHaveBeenCalled();
    expect(grants.provisioner.applyAfterCreateIfNone).not.toHaveBeenCalled();
  });
});

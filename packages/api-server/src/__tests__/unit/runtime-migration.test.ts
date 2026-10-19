// TEST_OVERVIEW: moving one agent from the container runtime to the vm
// TEST_OVERVIEW: runtime, reversibly until its machine has booted from the
// TEST_OVERVIEW: copy. An operator asks for a move by writing the request
// TEST_OVERVIEW: annotation alone; the api-server refuses every agent the
// TEST_OVERVIEW: controller could not move, withdraws a request it refuses, and
// TEST_OVERVIEW: otherwise records the target shape without touching the spec.
// TEST_OVERVIEW: The controller reports progress in the RuntimeMigrating
// TEST_OVERVIEW: condition, which the api-server reads back into the phase the
// TEST_OVERVIEW: browser shows, and it switches the Backend itself once the
// TEST_OVERVIEW: controller reports the boot verified. Every write names the
// TEST_OVERVIEW: version it was decided from.
import { describe, it, expect, vi } from "vitest";
import { toAgentView, type Agent, type AgentSpec } from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import { events$, EventType } from "../../events.js";
import {
  createRuntimeMigrationSwitch,
  executeRuntimeMigration,
  type RuntimeMigrationWrite,
} from "../../modules/agents/services/runtime-migration.js";
import {
  movedStorageSize,
  runtimeMigrationOf,
  runtimeMigrationRefusalReasons,
  type AgentMount,
  type VmPoolCapacity,
} from "../../modules/agents/domain/runtime-migration.js";
import {
  assembleAgent,
  parseInfraAgent,
  type InfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";
import type { RuntimeMigrationWriteResult } from "../../modules/agents/infrastructure/agents-repository.js";
import { runtimeFeaturesOf } from "agent-runtime-api";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { createLiveAgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import { fakeK8s } from "../helpers/fake-k8s.js";

configureLogger({ level: "error", write: () => {} });

const OWNER = "kc|owner-1";
const CHART_MOUNTS = [
  { path: "/home/agent", persist: true },
  { path: "/tmp", persist: false },
];
const REQUEST = "agent-platform.ai/runtime-migration";
const TARGET = "agent-platform.ai/runtime-migration-target";
const SNAPSHOT = "agent-platform.ai/runtime-migration-snapshot";
const RETRY = "agent-platform.ai/runtime-migration-retry";

const CLEARED = {
  [REQUEST]: null,
  [TARGET]: null,
  [SNAPSHOT]: null,
  [RETRY]: null,
};

function infraAgent(overrides?: Partial<InfraAgent>): InfraAgent {
  return {
    id: "agent-1",
    name: "my-agent",
    templateId: "claude-code",
    resourceVersion: "41",
    spec: {
      name: "my-agent",
      image: "quay.io/dam-agents/claude-code:0.2.7",
      runtimeClassName: "gvisor",
      nodeSelector: { pool: "agents" },
      mounts: [{ path: "/home/agent", persist: true }],
    },
    sweepable: false,
    lifetimeMs: 0,
    ready: false,
    hibernated: true,
    stopRequested: false,
    disabled: false,
    overBudget: false,
    podRestarts: 0,
    owner: OWNER,
    ...overrides,
  };
}

function migrating(phase: string, overrides?: Partial<InfraAgent>): InfraAgent {
  const vm = overrides?.spec?.backend?.type === "vm";
  const runtimeMigration = runtimeMigrationOf({
    requested: "requested",
    condition: { reason: phase },
    vm,
  });
  return infraAgent({
    ...(runtimeMigration ? { runtimeMigration } : {}),
    ...overrides,
  });
}

function writes(...agents: (InfraAgent | null)[]): {
  getAgent: () => Promise<InfraAgent | null>;
  writeMigration: ReturnType<
    typeof vi.fn<
      (
        id: string,
        patch: RuntimeMigrationWrite,
      ) => Promise<RuntimeMigrationWriteResult>
    >
  >;
} {
  const reads = [...agents];
  const last = agents[agents.length - 1] ?? null;
  return {
    getAgent: async () => (reads.length > 0 ? (reads.shift() ?? null) : last),
    writeMigration: vi.fn(
      async (
        _id: string,
        _patch: RuntimeMigrationWrite,
      ): Promise<RuntimeMigrationWriteResult> =>
        last ? { ok: true, value: last } : { ok: false, reason: "not-found" },
    ),
  };
}

function harness(opts?: {
  agent?: InfraAgent | null;
  virtualizationEnabled?: boolean;
  defaultMounts?: AgentMount[];
  capacity?: VmPoolCapacity;
  homeBytes?: number | null;
}) {
  const agent = opts?.agent === undefined ? infraAgent() : opts.agent;
  const deps = writes(agent);
  const run = executeRuntimeMigration({
    owner: OWNER,
    migration: async () => ({
      virtualizationEnabled: opts?.virtualizationEnabled ?? true,
      defaultMounts: opts?.defaultMounts ?? CHART_MOUNTS,
      defaultStorageSize: "10Gi",
      capacity: opts?.capacity ?? null,
      homeBytes: opts?.homeBytes ?? null,
    }),
    ...deps,
  });
  return { run, writeMigration: deps.writeMigration };
}

describe("runtime migration request", () => {
  // TEST_SCENARIO: the request writes no spec. The container spec stays the Agent's spec until the machine has booted from the copy, so the request carries the target shape alone, written against the version the refusals were checked on.
  it("records the target and leaves the spec alone", async () => {
    const h = harness();
    const res = await h.run("agent-1");
    expect(res.ok).toBe(true);
    expect(h.writeMigration).toHaveBeenCalledTimes(1);
    expect(h.writeMigration).toHaveBeenCalledWith("agent-1", {
      annotations: {
        [REQUEST]: "requested",
        [TARGET]: "{}",
        [SNAPSHOT]: null,
        [RETRY]: null,
      },
      resourceVersion: "41",
    });
  });

  // TEST_SCENARIO: the machine's one disk holds what HOME's volume held, so a HOME mount that names a size larger than the Agent's storageSize sizes the target's disk, as the container backend sized that volume. The mounts are left as they are, and a non-persisted mount is carried by nothing and refuses nothing.
  it("sizes the target's disk for HOME's own volume", async () => {
    const h = harness({
      agent: infraAgent({
        spec: {
          name: "my-agent",
          image: "img",
          storageSize: "10Gi",
          mounts: [
            { path: "/home/agent", persist: true, size: "20Gi" },
            { path: "/scratch", persist: false },
          ],
        },
      }),
    });
    expect((await h.run("agent-1")).ok).toBe(true);
    const annotations = h.writeMigration.mock.calls[0]?.[1].annotations ?? {};
    expect(JSON.parse(annotations[TARGET] ?? "")).toEqual({
      storageSize: "20Gi",
    });
    expect(h.writeMigration.mock.calls[0]?.[1].spec).toBeUndefined();
  });

  // TEST_SCENARIO: an Agent that names no mounts gets the install's template defaults from the controller. The migration plans from those same mounts, so a default that persists a path besides HOME refuses the move.
  it("plans from the template defaults when the agent names no mounts", async () => {
    const h = harness({
      agent: infraAgent({ spec: { name: "my-agent", image: "img" } }),
    });
    expect((await h.run("agent-1")).ok).toBe(true);
    expect(h.writeMigration.mock.calls[0]?.[1].annotations?.[TARGET]).toBe(
      "{}",
    );

    const refused = harness({
      agent: infraAgent({ spec: { name: "my-agent", image: "img" } }),
      defaultMounts: [
        { path: "/home/agent", persist: true },
        { path: "/data", persist: true, size: "5Gi" },
      ],
    });
    const res = await refused.run("agent-1");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.type).toBe("PersistsUnmovablePaths");
    expect(refused.writeMigration).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the refusal is checked on one read and the request is written later, against that read's resourceVersion. A write that keeps losing the race to another change — a storage migration, a second request — is reported as a concurrent update to retry rather than an error.
  it("reports a write that keeps losing a race as a concurrent update", async () => {
    const h = harness();
    h.writeMigration.mockResolvedValue({ ok: false, reason: "conflict" });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "ConcurrentUpdate" },
    });
  });

  // TEST_SCENARIO: nothing but HOME survives on the machine, so an Agent that does not persist HOME has nothing to carry over and is refused rather than moved empty.
  it("refuses an agent whose home is not persisted", async () => {
    for (const mounts of [
      [{ path: "/home/agent", persist: false }],
      [{ path: "/tmp", persist: false }],
    ]) {
      const h = harness({
        agent: infraAgent({ spec: { name: "my-agent", image: "img", mounts } }),
      });
      expect(await h.run("agent-1")).toEqual({
        ok: false,
        error: { type: "HomeNotPersisted" },
      });
      expect(h.writeMigration).not.toHaveBeenCalled();
    }
  });

  // TEST_SCENARIO: a running migration is checked before anything else, so even a request for an Agent that also reads as a vm Agent — one the previous api-server switched at once — says the move is under way, not that it is done.
  it("reports a running migration before an agent already on vm", async () => {
    const runtimeMigration = runtimeMigrationOf({
      requested: "copying",
      vm: true,
    });
    const h = harness({
      agent: infraAgent({
        spec: { name: "my-agent", image: "img", backend: { type: "vm" } },
        ...(runtimeMigration ? { runtimeMigration } : {}),
      }),
    });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "RuntimeMigrationInProgress" },
    });
  });

  it("rejects an unknown or unowned agent", async () => {
    const h = harness({ agent: null });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "AgentNotFound" },
    });
    expect(h.writeMigration).not.toHaveBeenCalled();
  });

  it("maps a patch-time disappearance to AgentNotFound", async () => {
    const h = harness();
    h.writeMigration.mockResolvedValueOnce({ ok: false, reason: "not-found" });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "AgentNotFound" },
    });
  });

  it("rejects an agent already on the vm backend", async () => {
    const h = harness({
      agent: infraAgent({
        spec: { name: "my-agent", image: "img", backend: { type: "vm" } },
      }),
    });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "AlreadyOnVm" },
    });
    expect(h.writeMigration).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: an install without virtualization has no VM runner, so the machine could never be made.
  it("rejects when virtualization is disabled on the install", async () => {
    const h = harness({ virtualizationEnabled: false });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "VirtualizationDisabled" },
    });
    expect(h.writeMigration).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a migration still running, or an abort whose vm side the controller is still removing, both refuse a new request: the controller would otherwise find its old condition on the new one.
  it("rejects while a runtime migration or its abort is still running", async () => {
    for (const runtimeMigration of [
      runtimeMigrationOf({
        requested: "requested",
        condition: { reason: "Copying" },
        vm: false,
      }),
      runtimeMigrationOf({ condition: { reason: "Copying" }, vm: false }),
    ]) {
      const h = harness({
        agent: infraAgent(runtimeMigration ? { runtimeMigration } : {}),
      });
      expect(await h.run("agent-1")).toEqual({
        ok: false,
        error: { type: "RuntimeMigrationInProgress" },
      });
      expect(h.writeMigration).not.toHaveBeenCalled();
    }
  });

  // TEST_SCENARIO: the storage migration moves the same workspace volume the runtime migration copies from; two copies at once would race on it.
  it("rejects while a storage migration is running", async () => {
    const h = harness({ agent: infraAgent({ storageMigrating: true }) });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "StorageMigrationInProgress" },
    });
    expect(h.writeMigration).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the move keeps the seed and then as much again on the machine's disk, so the pool is asked for twice what the home holds, up to the level the runner refuses a seed at. A pool that cannot hold it refuses the request before anything is written, rather than stopping the container and filling the storage the owner's other VM agents share.
  it("refuses a move the owner's pool cannot hold twice over", async () => {
    const h = harness({
      homeBytes: 10 * 1024 ** 3,
      capacity: {
        storage: { usedBytes: 0, usableBytes: 20 * 1024 ** 3 },
        memory: { committedMiB: 0, limitMiB: 12 * 1024 },
      },
    });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: {
        type: "VmStorageInsufficient",
        neededBytes: 20 * 1024 ** 3,
        usedBytes: 0,
        usableBytes: 20 * 1024 ** 3,
      },
    });
    expect(h.writeMigration).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the pool is judged on what the home holds, not on the size its volume may grow to, so a small home on a volume with room to spare moves to a pool that could never take the whole volume.
  it("allows a home that fits, however large its volume may grow", async () => {
    const h = harness({
      homeBytes: 3 * 1024 ** 3,
      capacity: {
        storage: { usedBytes: 0, usableBytes: 20 * 1024 ** 3 },
        memory: { committedMiB: 0, limitMiB: 12 * 1024 },
      },
    });
    expect((await h.run("agent-1")).ok).toBe(true);
  });

  // TEST_SCENARIO: a claim backed by a directory on a node — the local path a test cluster hands out — is mounted from a filesystem the whole node shares, so the runtime measures that filesystem and reports the node's use as the home's. It is the volume at most, or the e2e lane would refuse every move on a pool that holds them all.
  it("reads a measurement larger than the volume as the volume at most", async () => {
    const h = harness({
      homeBytes: 90 * 1024 ** 3,
      capacity: {
        storage: { usedBytes: 0, usableBytes: 40 * 1024 ** 3 },
        memory: { committedMiB: 0, limitMiB: 12 * 1024 },
      },
    });
    expect((await h.run("agent-1")).ok).toBe(true);
  });

  // TEST_SCENARIO: a home that fits twice over leaves the request alone, and so does a home or a pool that could not be read: an unmeasured home is judged on nothing, since refusing it on the size its volume may grow to would stop a small home on a large claim, and the runner refuses what it has no room for on its own.
  it("allows a move the pool holds, and refuses nothing unmeasured", async () => {
    for (const capacity of [
      {
        storage: { usedBytes: 0, usableBytes: 40 * 1024 ** 3 },
        memory: { committedMiB: 0, limitMiB: 12 * 1024 },
      },
      undefined,
    ])
      for (const homeBytes of [3 * 1024 ** 3, null])
        expect((await harness({ capacity, homeBytes }).run("agent-1")).ok).toBe(
          true,
        );
  });

  // TEST_SCENARIO: a machine may grow to half the pool and is admitted against what the pool has committed, so a pool past half committed has no room for the machine the move would boot. The request refuses it there, before the copy, rather than at the boot after the container stopped.
  it("refuses a move the pool has no memory for", async () => {
    const h = harness({
      capacity: {
        storage: { usedBytes: 0, usableBytes: 40 * 1024 ** 3 },
        memory: { committedMiB: 7 * 1024, limitMiB: 12 * 1024 },
      },
    });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: {
        type: "VmMemoryInsufficient",
        committedMiB: 7 * 1024,
        limitMiB: 12 * 1024,
      },
    });
    expect(h.writeMigration).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the machine keeps only HOME and the copy carries only HOME's volume, so every other persisted path — outside HOME, or a volume of its own inside it — would be lost. Each is refused, in the order the mounts name it, with the one reason the browser shows; a mount that is not persisted is no reason to refuse, and nothing is written.
  it("refuses every persisted path besides HOME, naming why", async () => {
    const h = harness({
      agent: infraAgent({
        spec: {
          name: "my-agent",
          image: "img",
          mounts: [
            { path: "/home/agent", persist: true },
            { path: "/data", persist: true },
            { path: "/home/agent/cache", persist: true },
            { path: "/tmp", persist: false },
          ],
        },
      }),
    });
    const res = await h.run("agent-1");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toEqual({
      type: "PersistsUnmovablePaths",
      paths: [
        {
          path: "/data",
          reason: "a move carries only the home directory",
        },
        {
          path: "/home/agent/cache",
          reason: "a move carries only the home directory",
        },
      ],
    });
    if (res.error.type !== "PersistsUnmovablePaths") return;
    expect(runtimeMigrationRefusalReasons(res.error)).toEqual([
      "/data cannot be moved: a move carries only the home directory",
      "/home/agent/cache cannot be moved: a move carries only the home directory",
    ]);
    expect(h.writeMigration).not.toHaveBeenCalled();
  });
});

describe("the Backend switch", () => {
  const target = JSON.stringify({ storageSize: "30Gi" });

  function switcher(agents: InfraAgent[]) {
    const deps = writes(...agents);
    const sweep = createRuntimeMigrationSwitch({
      listAgents: async () => agents,
      migration: async () => ({
        virtualizationEnabled: true,
        defaultMounts: CHART_MOUNTS,
        defaultStorageSize: "10Gi",
      }),
      ...deps,
      log: () => {},
    });
    return { sweep, writeMigration: deps.writeMigration };
  }

  // TEST_SCENARIO: the api-server is the only spec writer, so it is the one that makes a migration permanent. Once the controller reports the boot verified, the spec takes the target shape — clearing runtimeClassName and nodeSelector, which the CRD rejects on the vm backend — and the request is withdrawn in the same write.
  it("switches a verified agent to its target shape", async () => {
    const s = switcher([
      migrating("Verified", { runtimeMigrationTarget: target }),
    ]);
    await s.sweep.tick();
    expect(s.writeMigration).toHaveBeenCalledWith("agent-1", {
      spec: {
        backend: { type: "vm" },
        runtimeClassName: null,
        nodeSelector: null,
        storageSize: "30Gi",
      },
      annotations: CLEARED,
      resourceVersion: "41",
    });
  });

  // TEST_SCENARIO: nothing before the verified boot switches, and neither does an agent whose target cannot be read, which would otherwise be switched to a shape nobody asked for.
  it("leaves every other agent alone", async () => {
    const s = switcher([
      migrating("Booting", { runtimeMigrationTarget: target }),
      migrating("Failed", { runtimeMigrationTarget: target }),
      migrating("Verified", { runtimeMigrationTarget: "not json" }),
      infraAgent(),
    ]);
    await s.sweep.tick();
    expect(s.writeMigration).not.toHaveBeenCalled();
  });
});

describe("a move an operator asks for", () => {
  // TEST_SCENARIO: the trigger is the request annotation alone. The api-server decides the move as it would for any other caller, so the request it writes names the target shape and leaves the spec to the controller's copy.
  it("decides the request the operator wrote and writes its target", async () => {
    const asked = migrating("Requested");
    expect(asked.runtimeMigrationTarget).toBeUndefined();
    const deps = writes(asked);
    const logged: string[] = [];
    const sweep = createRuntimeMigrationSwitch({
      listAgents: async () => [asked],
      migration: async () => ({
        virtualizationEnabled: true,
        defaultMounts: CHART_MOUNTS,
        defaultStorageSize: "10Gi",
      }),
      ...deps,
      log: (message) => logged.push(message),
    });
    await sweep.tick();
    expect(deps.writeMigration).toHaveBeenCalledTimes(1);
    expect(deps.writeMigration.mock.calls[0]?.[1]).toMatchObject({
      annotations: { [REQUEST]: "requested", [TARGET]: "{}" },
      resourceVersion: "41",
    });
    expect(logged).toEqual([]);
  });

  // TEST_SCENARIO: a move the api-server refuses is withdrawn rather than left standing, since a request nobody can carry out would hold the Agent waiting on a machine that is never made; the reasons go to the log the operator reads.
  it("withdraws a request it refuses and logs why", async () => {
    const asked = migrating("Requested");
    const deps = writes(asked);
    const logged: string[] = [];
    const sweep = createRuntimeMigrationSwitch({
      listAgents: async () => [asked],
      migration: async () => ({
        virtualizationEnabled: false,
        defaultMounts: CHART_MOUNTS,
        defaultStorageSize: "10Gi",
      }),
      ...deps,
      log: (message) => logged.push(message),
    });
    await sweep.tick();
    expect(deps.writeMigration).toHaveBeenCalledWith("agent-1", {
      annotations: CLEARED,
      resourceVersion: "41",
    });
    expect(logged.join("\n")).toMatch(/virtualization\.enabled/);
  });

  // TEST_SCENARIO: a move is asked for from outside the app, so nothing an open page does would refresh the row; each write the sweep makes publishes the Agent for its owner, and one it refuses without writing publishes nothing.
  it("publishes the Agent it changes, and only then", async () => {
    const asked = migrating("Requested");
    const deps = writes(asked);
    const seen: unknown[] = [];
    const sub = events$().subscribe((event) => seen.push(event));
    const sweep = createRuntimeMigrationSwitch({
      listAgents: async () => [asked],
      migration: async () => ({
        virtualizationEnabled: true,
        defaultMounts: CHART_MOUNTS,
        defaultStorageSize: "10Gi",
      }),
      ...deps,
      log: () => {},
    });
    await sweep.tick();
    sub.unsubscribe();
    expect(seen).toEqual([
      { type: EventType.AgentUpdated, agentId: asked.id, ownerSub: OWNER },
    ]);
  });

  // TEST_SCENARIO: a request that lost a write race was not refused: it stands, so the next tick decides it again and nothing is withdrawn.
  it("leaves a request that lost a write race standing", async () => {
    const asked = migrating("Requested");
    const deps = writes(asked);
    deps.writeMigration.mockResolvedValue({ ok: false, reason: "conflict" });
    const logged: string[] = [];
    const sweep = createRuntimeMigrationSwitch({
      listAgents: async () => [asked],
      migration: async () => ({
        virtualizationEnabled: true,
        defaultMounts: CHART_MOUNTS,
        defaultStorageSize: "10Gi",
      }),
      ...deps,
      log: (message) => logged.push(message),
    });
    await sweep.tick();
    expect(
      deps.writeMigration.mock.calls.map(([, patch]) => patch.annotations),
    ).not.toContainEqual(CLEARED);
    expect(logged).toEqual([]);
  });

  // TEST_SCENARIO: a request that already names a target is the api-server's own decision from an earlier tick, and is not decided again.
  it("leaves a request that already names a target alone", async () => {
    const decided = migrating("Requested", { runtimeMigrationTarget: "{}" });
    const deps = writes(decided);
    const sweep = createRuntimeMigrationSwitch({
      listAgents: async () => [decided],
      migration: async () => ({
        virtualizationEnabled: true,
        defaultMounts: CHART_MOUNTS,
        defaultStorageSize: "10Gi",
      }),
      ...deps,
      log: () => {},
    });
    await sweep.tick();
    expect(deps.writeMigration).not.toHaveBeenCalled();
  });
});

describe("the moved agent's disk", () => {
  const spec = (over: Partial<AgentSpec>): AgentSpec => ({
    name: "a",
    image: "img",
    ...over,
  });

  // TEST_SCENARIO: a HOME mount that names no size was sized from the Agent's storageSize, so the disk keeps the size the Agent asks for.
  it("is left alone when HOME names no size", () => {
    expect(
      movedStorageSize(
        spec({}),
        [{ path: "/home/agent", persist: true }],
        "10Gi",
      ),
    ).toBeUndefined();
  });

  // TEST_SCENARIO: a HOME mount's own size won over the Agent's storageSize on the container backend, so the disk is sized for it, rounded up to whole GiB. Other mounts add nothing: the migration refuses any other persisted path.
  it("is HOME's own size when it asks for more", () => {
    expect(
      movedStorageSize(
        spec({}),
        [
          { path: "/home/agent", persist: true, size: "10500Mi" },
          { path: "/tmp", persist: false, size: "50Gi" },
        ],
        "10Gi",
      ),
    ).toBe("11Gi");
  });

  // TEST_SCENARIO: a disk never gets smaller than the Agent asks for, and a size that cannot be read leaves the disk as the Agent asks rather than guessing.
  it("never shrinks below what the agent asks, nor guesses", () => {
    expect(
      movedStorageSize(
        spec({ storageSize: "50Gi" }),
        [{ path: "/home/agent", persist: true, size: "1Gi" }],
        "10Gi",
      ),
    ).toBeUndefined();
    expect(
      movedStorageSize(
        spec({}),
        [{ path: "/home/agent", persist: true, size: "1e3" }],
        "10Gi",
      ),
    ).toBeUndefined();
  });
});

function viewOf(
  annotations: Record<string, string>,
  spec?: object,
  status?: object,
  virtualizationEnabled = true,
) {
  const infra = parseInfraAgent({
    metadata: { name: "agent-1", annotations },
    spec: { name: "my-agent", ...spec },
    ...(status ? { status } : {}),
  });
  const agent: Agent = assembleAgent(
    infra,
    [],
    [],
    { container: 60, vm: 5 },
    false,
    undefined,
    runtimeFeaturesOf(null),
    [],
    [],
    {
      virtualizationEnabled,
      defaultMounts: CHART_MOUNTS,
      defaultStorageSize: "10Gi",
    },
  );
  return toAgentView(agent);
}

function condition(reason: string, message?: string) {
  return {
    conditions: [
      {
        type: "RuntimeMigrating",
        status: reason === "Failed" ? "False" : "True",
        reason,
        ...(message ? { message } : {}),
      },
    ],
  };
}

describe("the agent view's runtime migration", () => {
  it("is null when no migration was requested", () => {
    expect(viewOf({}).runtimeMigration).toBeNull();
  });

  // TEST_SCENARIO: the phase, its reason and the copy attempts come from the controller's condition and status; whether the user may abort or retry follows from the phase.
  it("carries the controller's phase, reason and attempts", () => {
    expect(
      viewOf(
        { [REQUEST]: "requested" },
        {},
        {
          ...condition("Copying", "copy attempt 1 of 3 failed"),
          runtimeMigrationAttempts: 2,
        },
      ).runtimeMigration,
    ).toEqual({
      phase: "copying",
      message: "copy attempt 1 of 3 failed",
      attempts: 2,
    });
    expect(
      viewOf({ [REQUEST]: "requested" }, {}, condition("Failed", "gave up"))
        .runtimeMigration,
    ).toEqual({
      phase: "failed",
      message: "gave up",
    });
    expect(
      viewOf({ [REQUEST]: "requested" }, {}, condition("Verified"))
        .runtimeMigration,
    ).toEqual({ phase: "verified" });
  });

  // TEST_SCENARIO: with the request withdrawn and the condition still there, the controller is still removing the vm side of an abort; the browser shows that rather than no migration, and offers nothing more to do.
  it("shows an abort the controller is still clearing up", () => {
    expect(viewOf({}, {}, condition("Copying")).runtimeMigration).toEqual({
      phase: "aborting",
    });
  });

  // TEST_SCENARIO: a request the previous controller took up carries its phase and message in annotations, and a newer controller may write a phase this api-server does not know yet; both still read as a running migration.
  it("reads a legacy phase and an unknown one", () => {
    expect(
      viewOf({
        [REQUEST]: "copying",
        "agent-platform.ai/runtime-migration-message": "runner is full",
      }).runtimeMigration,
    ).toEqual({
      phase: "copying",
      message: "runner is full",
    });
    expect(
      viewOf({ [REQUEST]: "requested" }, {}, condition("Verifying"))
        .runtimeMigration?.phase,
    ).toBe("requested");
  });

  // TEST_SCENARIO: the view offers the migration from the same refusal the request checks, so the browser never offers a move the request then refuses: not while a storage migration runs, not when the install has no VM runner, not for an Agent that does not persist HOME, and not while a migration of its own is under way, failed or being undone.
  it("does not offer a migration the request would refuse", () => {
    expect(
      viewOf({ "agent-platform.ai/storage-migration": "running" })
        .runtimeMigratable,
    ).toBe(false);
    expect(viewOf({}, undefined, undefined, false).runtimeMigratable).toBe(
      false,
    );
    expect(
      viewOf({}, { mounts: [{ path: "/tmp", persist: false }] })
        .runtimeMigratable,
    ).toBe(false);
    expect(
      viewOf({ [REQUEST]: "requested" }, {}, condition("Failed"))
        .runtimeMigratable,
    ).toBe(false);
    expect(viewOf({}, {}, condition("Copying")).runtimeMigratable).toBe(false);
  });

  it("offers the migration only to a container agent that persists nothing but HOME", () => {
    expect(viewOf({}).runtimeMigratable).toBe(true);
    expect(viewOf({}, { backend: { type: "vm" } }).runtimeMigratable).toBe(
      false,
    );
    expect(
      viewOf(
        {},
        {
          mounts: [
            { path: "/home/agent", persist: true },
            { path: "/tmp", persist: false },
          ],
        },
      ).runtimeMigratable,
    ).toBe(true);
    expect(
      viewOf(
        {},
        {
          mounts: [
            { path: "/home/agent", persist: true },
            { path: "/data", persist: true },
          ],
        },
      ).runtimeMigratable,
    ).toBe(false);
  });
});

function repoHarness() {
  const { client } = fakeK8s([
    {
      metadata: {
        name: "agent-1",
        resourceVersion: "41",
        labels: { "agent-platform.ai/owner": OWNER },
        annotations: {},
      },
      spec: { name: "my-agent" },
    },
  ]);
  const patch = vi.spyOn(client, "patchCustomObject");
  const repo = createAgentsRepository(
    client,
    createLiveAgentStateCache(client),
  );
  return { repo, patch };
}

describe("the Backend's immutability", () => {
  // TEST_SCENARIO: the Backend is fixed at create and the api-server is the only spec writer, so a spec write that names it outside the runtime migration must fail before it reaches the cluster.
  it("refuses a spec write that names the backend", async () => {
    const h = repoHarness();
    await expect(
      h.repo.updateSpec("agent-1", OWNER, { backend: { type: "vm" } }),
    ).rejects.toThrow(/backend/);
    await expect(
      h.repo.patchSpec("agent-1", { backend: { type: "vm" } }),
    ).rejects.toThrow(/backend/);
    expect(h.patch).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a migration write is one merge patch carrying the version it was decided from, which the API server checks, so it cannot land on a status the controller wrote meanwhile.
  it("sends the migration's spec, annotations and version in one merge patch", async () => {
    const h = repoHarness();
    const res = await h.repo.writeRuntimeMigration("agent-1", OWNER, {
      spec: { backend: { type: "vm" }, runtimeClassName: null },
      annotations: { [REQUEST]: null },
      resourceVersion: "41",
    });
    expect(res.ok).toBe(true);
    expect(h.patch).toHaveBeenCalledTimes(1);
    expect(h.patch).toHaveBeenCalledWith("agents", "agent-1", {
      metadata: { annotations: { [REQUEST]: null }, resourceVersion: "41" },
      spec: { backend: { type: "vm" }, runtimeClassName: null },
    });
  });

  // TEST_SCENARIO: the API server answers a stale version with 409; the repository reports it as a conflict for the caller to decide again, rather than as a failure.
  it("reports a stale version as a conflict", async () => {
    const h = repoHarness();
    h.patch.mockRejectedValueOnce(
      Object.assign(new Error("conflict"), { code: 409 }),
    );
    expect(
      await h.repo.writeRuntimeMigration("agent-1", OWNER, {
        annotations: {},
        resourceVersion: "40",
      }),
    ).toEqual({ ok: false, reason: "conflict" });
  });

  // TEST_SCENARIO: a read that carried no resourceVersion cannot condition the write, so the write is refused as a conflict rather than sent unconditioned.
  it("refuses a write it cannot condition on a resourceVersion", async () => {
    const h = repoHarness();
    expect(
      await h.repo.writeRuntimeMigration("agent-1", OWNER, {
        annotations: {},
        resourceVersion: undefined,
      }),
    ).toEqual({ ok: false, reason: "conflict" });
    expect(h.patch).not.toHaveBeenCalled();
  });

  it("does not migrate another owner's agent", async () => {
    const h = repoHarness();
    expect(
      await h.repo.writeRuntimeMigration("agent-1", "kc|someone-else", {
        annotations: {},
        resourceVersion: "41",
      }),
    ).toEqual({ ok: false, reason: "not-found" });
    expect(h.patch).not.toHaveBeenCalled();
  });
});

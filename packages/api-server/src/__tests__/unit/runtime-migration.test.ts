// TEST_OVERVIEW: moving one agent from the container runtime to the vm
// TEST_OVERVIEW: runtime, reversibly until its machine has booted from the
// TEST_OVERVIEW: copy. The api-server refuses every agent the controller could
// TEST_OVERVIEW: not move, and otherwise records a request without touching
// TEST_OVERVIEW: the spec: the target shape, a snapshot of what the switch
// TEST_OVERVIEW: changes, and where each persisted path goes. The controller
// TEST_OVERVIEW: reports progress in the RuntimeMigrating condition; the
// TEST_OVERVIEW: api-server reads it back into the phase the browser shows,
// TEST_OVERVIEW: aborts or retries on the user's word, and switches the
// TEST_OVERVIEW: Backend itself once the controller reports the boot verified.
// TEST_OVERVIEW: Every write names the version it was decided from.
import { describe, it, expect, vi } from "vitest";
import { toAgentView, type Agent, type AgentSpec } from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import {
  createRuntimeMigrationSwitch,
  executeAbortRuntimeMigration,
  executeRetryRuntimeMigration,
  executeRuntimeMigration,
  type RuntimeMigrationWrite,
} from "../../modules/agents/services/runtime-migration.js";
import {
  movedStorageSize,
  runtimeMigrationOf,
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
const REQUEST = "agent-platform.ai/runtime-migration";
const TARGET = "agent-platform.ai/runtime-migration-target";
const SNAPSHOT = "agent-platform.ai/runtime-migration-snapshot";
const MOUNTS = "agent-platform.ai/runtime-migration-mounts";
const RETRY = "agent-platform.ai/runtime-migration-retry";

const CLEARED = {
  [REQUEST]: null,
  [TARGET]: null,
  [SNAPSHOT]: null,
  [MOUNTS]: null,
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
    overBudget: false,
    podRestarts: 0,
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
}) {
  const agent = opts?.agent === undefined ? infraAgent() : opts.agent;
  const deps = writes(agent);
  const run = executeRuntimeMigration({
    owner: OWNER,
    virtualizationEnabled: opts?.virtualizationEnabled ?? true,
    defaultStorageSize: "10Gi",
    ...deps,
  });
  return { run, writeMigration: deps.writeMigration };
}

describe("runtime migration request", () => {
  // TEST_SCENARIO: the request writes no spec. The container spec stays the Agent's spec until the machine has booted from the copy, so the request carries the target shape and a snapshot of every field the switch will change, written against the version the refusals were checked on.
  it("records the target and a snapshot, and leaves the spec alone", async () => {
    const h = harness();
    const res = await h.run("agent-1");
    expect(res.ok).toBe(true);
    expect(h.writeMigration).toHaveBeenCalledTimes(1);
    expect(h.writeMigration).toHaveBeenCalledWith("agent-1", {
      annotations: {
        [REQUEST]: "requested",
        [TARGET]: "{}",
        [SNAPSHOT]: JSON.stringify({
          backend: null,
          mounts: [{ path: "/home/agent", persist: true }],
          storageSize: null,
          runtimeClassName: "gvisor",
          nodeSelector: { pool: "agents" },
        }),
        [RETRY]: null,
        [MOUNTS]: null,
      },
      resourceVersion: "41",
    });
  });

  // TEST_SCENARIO: an agent that persisted other paths on the container backend moves with them. A path under HOME keeps its place and one outside moves below HOME's persisted directory; the target's mounts are rewritten to match, its disk is sized for every volume together since the runner refuses a seed larger than the disk, and the controller is told where each old path went so it can find that path's volume. A non-persisted mount is left as it is.
  it("moves persisted paths below HOME and says where each went", async () => {
    const h = harness({
      agent: infraAgent({
        spec: {
          name: "my-agent",
          image: "img",
          storageSize: "10Gi",
          mounts: [
            { path: "/home/agent", persist: true },
            { path: "/home/agent/cache", persist: true, size: "5Gi" },
            { path: "/data", persist: true, size: "20Gi" },
            { path: "/scratch", persist: false },
          ],
        },
      }),
    });
    expect((await h.run("agent-1")).ok).toBe(true);
    const annotations = h.writeMigration.mock.calls[0]?.[1].annotations ?? {};
    expect(JSON.parse(annotations[TARGET] ?? "")).toEqual({
      mounts: [
        { path: "/home/agent", persist: true },
        { path: "/home/agent/cache", persist: true, size: "5Gi" },
        { path: "/home/agent/.persisted/data", persist: true, size: "20Gi" },
        { path: "/scratch", persist: false },
      ],
      storageSize: "35Gi",
    });
    expect(JSON.parse(annotations[MOUNTS] ?? "")).toEqual({
      "/home/agent/cache": "/home/agent/cache",
      "/data": "/home/agent/.persisted/data",
    });
    expect(h.writeMigration.mock.calls[0]?.[1].spec).toBeUndefined();
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

  // TEST_SCENARIO: some paths cannot be linked back in a machine without breaking it: the root, one at, inside or above HOME or a path the platform lays out, one that is not a plain path, and one already inside HOME's persisted directory, where moved paths go. Each is refused with its reason, and nothing is written.
  it("refuses paths the machine cannot keep, naming why", async () => {
    const h = harness({
      agent: infraAgent({
        spec: {
          name: "my-agent",
          image: "img",
          mounts: [
            { path: "/home/agent", persist: true },
            { path: "/data", persist: true },
            { path: "/etc", persist: true },
            { path: "/proc/x", persist: true },
            { path: "/home", persist: true },
            { path: "/opt/../etc", persist: true },
            { path: "/home/agent/.persisted/x", persist: false },
          ],
        },
      }),
    });
    const res = await h.run("agent-1");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.type).toBe("PersistsUnmovablePaths");
    if (res.error.type !== "PersistsUnmovablePaths") return;
    expect(res.error.paths.map((p) => p.path)).toEqual([
      "/etc",
      "/proc/x",
      "/home",
      "/opt/../etc",
      "/home/agent/.persisted/x",
    ]);
    expect(res.error.paths[0]?.reason).toContain("/etc/platform");
    expect(h.writeMigration).not.toHaveBeenCalled();
  });
});

describe("aborting a runtime migration", () => {
  const snapshot = JSON.stringify({
    backend: null,
    mounts: [{ path: "/data", persist: true }],
    storageSize: "20Gi",
    runtimeClassName: "gvisor",
    nodeSelector: { pool: "agents" },
  });

  // TEST_SCENARIO: an abort before the verified boot withdraws the request and writes the snapshot's fields back, against the version it read, so the Agent is the container Agent it was before the request.
  it("withdraws the request and restores the snapshot", async () => {
    const deps = writes(
      migrating("Copying", { runtimeMigrationSnapshot: snapshot }),
    );
    const res = await executeAbortRuntimeMigration({ owner: OWNER, ...deps })(
      "agent-1",
    );
    expect(res.ok).toBe(true);
    expect(deps.writeMigration).toHaveBeenCalledWith("agent-1", {
      spec: {
        mounts: [{ path: "/data", persist: true }],
        storageSize: "20Gi",
        runtimeClassName: "gvisor",
        nodeSelector: { pool: "agents" },
      },
      annotations: CLEARED,
      resourceVersion: "41",
    });
  });

  // TEST_SCENARIO: a failed migration is aborted like a running one: failing does not take the Agent past the point of no return.
  it("is allowed from every phase before the boot is verified", async () => {
    for (const phase of [
      "Requested",
      "Stopping",
      "Copying",
      "Booting",
      "Failed",
    ]) {
      const deps = writes(migrating(phase));
      const res = await executeAbortRuntimeMigration({ owner: OWNER, ...deps })(
        "agent-1",
      );
      expect(res.ok, phase).toBe(true);
    }
  });

  // TEST_SCENARIO: once the machine has booted from the copy the migration is past its point of no return, and an agent with no migration has nothing to abort; neither is written to.
  it("is refused once verified, or without a migration", async () => {
    for (const [agent, type] of [
      [migrating("Verified"), "RuntimeMigrationVerified"],
      [infraAgent(), "NoRuntimeMigration"],
    ] as const) {
      const deps = writes(agent);
      expect(
        await executeAbortRuntimeMigration({ owner: OWNER, ...deps })(
          "agent-1",
        ),
      ).toEqual({ ok: false, error: { type } });
      expect(deps.writeMigration).not.toHaveBeenCalled();
    }
  });

  // TEST_SCENARIO: the controller verified the boot between the abort's read and its write. The write conflicts on the version it named, the abort reads again, sees the migration verified, and is refused rather than landing on a machine that is already the Agent's.
  it("loses to a verified boot that landed first", async () => {
    const deps = writes(migrating("Booting"), migrating("Verified"));
    deps.writeMigration.mockResolvedValueOnce({
      ok: false,
      reason: "conflict",
    });
    expect(
      await executeAbortRuntimeMigration({ owner: OWNER, ...deps })("agent-1"),
    ).toEqual({ ok: false, error: { type: "RuntimeMigrationVerified" } });
    expect(deps.writeMigration).toHaveBeenCalledTimes(1);
  });
});

describe("retrying a runtime migration", () => {
  // TEST_SCENARIO: a retry is asked only of a failed migration, and is a stamp the controller compares with the time it failed; it writes nothing else.
  it("stamps a failed migration and refuses any other", async () => {
    const at = new Date("2026-09-28T10:00:00.123Z");
    const deps = writes(migrating("Failed"));
    const res = await executeRetryRuntimeMigration({
      owner: OWNER,
      ...deps,
      now: () => at,
    })("agent-1");
    expect(res.ok).toBe(true);
    expect(deps.writeMigration).toHaveBeenCalledWith("agent-1", {
      annotations: { [RETRY]: "2026-09-28T10:00:00Z" },
      resourceVersion: "41",
    });

    const running = writes(migrating("Copying"));
    expect(
      await executeRetryRuntimeMigration({ owner: OWNER, ...running })(
        "agent-1",
      ),
    ).toEqual({ ok: false, error: { type: "RuntimeMigrationNotFailed" } });
    expect(running.writeMigration).not.toHaveBeenCalled();
  });
});

describe("the Backend switch", () => {
  const target = JSON.stringify({
    mounts: [{ path: "/home/agent/.persisted/data", persist: true }],
    storageSize: "30Gi",
  });

  function switcher(agents: InfraAgent[]) {
    const deps = writes(...agents);
    const sweep = createRuntimeMigrationSwitch({
      listAgents: async () => agents,
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
        mounts: [{ path: "/home/agent/.persisted/data", persist: true }],
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

describe("the moved agent's disk", () => {
  const spec = (over: Partial<AgentSpec>): AgentSpec => ({
    name: "a",
    image: "img",
    ...over,
  });

  it("is left alone when only HOME moves", () => {
    expect(
      movedStorageSize(
        spec({ mounts: [{ path: "/home/agent", persist: true }] }),
        {},
        "10Gi",
      ),
    ).toBeUndefined();
  });

  it("adds up every volume, each falling back as the container sized it", () => {
    const s = spec({
      mounts: [
        { path: "/home/agent", persist: true },
        { path: "/data", persist: true, size: "500Mi" },
      ],
    });
    expect(
      movedStorageSize(s, { "/data": "/home/agent/.persisted/data" }, "10Gi"),
    ).toBe("11Gi");
  });

  // TEST_SCENARIO: a disk never gets smaller than the Agent asks for, and a size that cannot be read leaves the disk as the Agent asks rather than guessing.
  it("never shrinks below what the agent asks, nor guesses", () => {
    const moves = { "/data": "/home/agent/.persisted/data" };
    expect(
      movedStorageSize(
        spec({
          storageSize: "50Gi",
          mounts: [
            { path: "/home/agent", persist: true, size: "1Gi" },
            { path: "/data", persist: true, size: "1Gi" },
          ],
        }),
        moves,
        "10Gi",
      ),
    ).toBe("50Gi");
    expect(
      movedStorageSize(
        spec({ mounts: [{ path: "/data", persist: true, size: "1e3" }] }),
        moves,
        "10Gi",
      ),
    ).toBeUndefined();
  });
});

function viewOf(
  annotations: Record<string, string>,
  spec?: object,
  status?: object,
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
    60,
    false,
    undefined,
    runtimeFeaturesOf(null),
    [],
    [],
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
      abortable: true,
      retryable: false,
    });
    expect(
      viewOf({ [REQUEST]: "requested" }, {}, condition("Failed", "gave up"))
        .runtimeMigration,
    ).toEqual({
      phase: "failed",
      message: "gave up",
      abortable: true,
      retryable: true,
    });
    expect(
      viewOf({ [REQUEST]: "requested" }, {}, condition("Verified"))
        .runtimeMigration,
    ).toEqual({ phase: "verified", abortable: false, retryable: false });
  });

  // TEST_SCENARIO: with the request withdrawn and the condition still there, the controller is still removing the vm side of an abort; the browser shows that rather than no migration, and offers nothing more to do.
  it("shows an abort the controller is still clearing up", () => {
    expect(viewOf({}, {}, condition("Copying")).runtimeMigration).toEqual({
      phase: "aborting",
      abortable: false,
      retryable: false,
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
      abortable: true,
      retryable: false,
    });
    expect(
      viewOf({ [REQUEST]: "requested" }, {}, condition("Verifying"))
        .runtimeMigration?.phase,
    ).toBe("requested");
  });

  it("offers the migration only to a container agent whose paths can all move", () => {
    expect(viewOf({}).runtimeMigratable).toBe(true);
    expect(viewOf({}, { backend: { type: "vm" } }).runtimeMigratable).toBe(
      false,
    );
    expect(
      viewOf({}, { mounts: [{ path: "/data", persist: true }] })
        .runtimeMigratable,
    ).toBe(true);
    expect(
      viewOf({}, { mounts: [{ path: "/proc/x", persist: true }] })
        .runtimeMigratable,
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

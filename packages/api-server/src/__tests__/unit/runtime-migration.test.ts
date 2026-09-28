// TEST_OVERVIEW: moving one agent from the container runtime to the vm
// TEST_OVERVIEW: runtime. The api-server refuses every agent the controller
// TEST_OVERVIEW: could not move, and otherwise writes one merge patch that
// TEST_OVERVIEW: switches the Backend, rewrites persisted paths to where they
// TEST_OVERVIEW: live below HOME, and asks the controller to start the copy.
// TEST_OVERVIEW: The controller reports progress in annotations, and the
// TEST_OVERVIEW: api-server reads them back into the phase the browser shows.
import { describe, it, expect, vi } from "vitest";
import { toAgentView, type Agent, type AgentSpec } from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import {
  executeRuntimeMigration,
  type RuntimeMigrationPatch,
} from "../../modules/agents/services/agents-service.js";
import {
  movedStorageSize,
  type AgentMount,
} from "../../modules/agents/domain/runtime-migration.js";
import {
  assembleAgent,
  parseInfraAgent,
  type InfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";
import { runtimeFeaturesOf } from "agent-runtime-api";
import {
  createAgentsRepository,
  type MigrateBackendOutcome,
} from "../../modules/agents/infrastructure/agents-repository.js";
import { createLiveAgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import { fakeK8s } from "../helpers/fake-k8s.js";

configureLogger({ level: "error", write: () => {} });

const OWNER = "kc|owner-1";

function infraAgent(overrides?: Partial<InfraAgent>): InfraAgent {
  return {
    id: "agent-1",
    name: "my-agent",
    resourceVersion: "41",
    templateId: "claude-code",
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

const CHART_MOUNTS = [
  { path: "/home/agent", persist: true },
  { path: "/tmp", persist: false },
];

function harness(opts?: {
  agent?: InfraAgent | null;
  virtualizationEnabled?: boolean;
  defaultMounts?: AgentMount[];
}) {
  const agent = opts?.agent === undefined ? infraAgent() : opts.agent;
  const writeMigration = vi.fn(
    async (
      _id: string,
      _patch: RuntimeMigrationPatch,
    ): Promise<MigrateBackendOutcome> =>
      agent ? { kind: "migrated", agent } : { kind: "not-found" },
  );
  const run = executeRuntimeMigration({
    owner: OWNER,
    migration: {
      virtualizationEnabled: opts?.virtualizationEnabled ?? true,
      defaultMounts: opts?.defaultMounts ?? CHART_MOUNTS,
    },
    defaultStorageSize: "10Gi",
    getAgent: async () => agent,
    writeMigration,
  });
  return { run, writeMigration };
}

describe("runtime migration request", () => {
  // TEST_SCENARIO: the CRD rejects runtimeClassName and nodeSelector on the vm backend, so the patch must null both in the same write that sets the backend, or the API server refuses the whole patch.
  it("writes one patch that switches the backend and requests the copy", async () => {
    const h = harness();
    const res = await h.run("agent-1");
    expect(res.ok).toBe(true);
    expect(h.writeMigration).toHaveBeenCalledTimes(1);
    expect(h.writeMigration).toHaveBeenCalledWith("agent-1", {
      spec: {
        backend: { type: "vm" },
        runtimeClassName: null,
        nodeSelector: null,
      },
      annotations: { "agent-platform.ai/runtime-migration": "requested" },
      resourceVersion: "41",
    });
  });

  // TEST_SCENARIO: an agent that persisted other paths on the container backend moves with them. A path under HOME keeps its place and one outside moves below HOME's persisted directory; the mounts are rewritten to match in the same write, the moved one naming the path it came from so the machine can put it back at every boot, the disk is sized for every volume together since the runner refuses a seed larger than the disk, and the controller is told where each old path went so it can find that path's volume. A non-persisted mount is left as it is.
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
    expect(h.writeMigration).toHaveBeenCalledWith("agent-1", {
      spec: {
        backend: { type: "vm" },
        runtimeClassName: null,
        nodeSelector: null,
        storageSize: "35Gi",
        mounts: [
          { path: "/home/agent", persist: true },
          { path: "/home/agent/cache", persist: true, size: "5Gi" },
          {
            path: "/home/agent/.persisted/data",
            persist: true,
            size: "20Gi",
            movedFrom: "/data",
          },
          { path: "/scratch", persist: false },
        ],
      },
      annotations: {
        "agent-platform.ai/runtime-migration": "requested",
        "agent-platform.ai/runtime-migration-mounts": JSON.stringify({
          "/home/agent/cache": "/home/agent/cache",
          "/data": "/home/agent/.persisted/data",
        }),
      },
      resourceVersion: "41",
    });
  });

  // TEST_SCENARIO: an Agent that names no mounts gets the install's template defaults from the controller. The migration plans from those same mounts, so a default that persists a path outside HOME moves with the Agent, written out as its mounts and naming the path it came from, instead of being flipped for the controller to refuse.
  it("plans from the template defaults when the agent names no mounts", async () => {
    const h = harness({
      agent: infraAgent({ spec: { name: "my-agent", image: "img" } }),
      defaultMounts: [
        { path: "/home/agent", persist: true },
        { path: "/data", persist: true, size: "5Gi" },
      ],
    });
    expect((await h.run("agent-1")).ok).toBe(true);
    const patch = h.writeMigration.mock.calls[0]?.[1];
    expect(patch?.spec.mounts).toEqual([
      { path: "/home/agent", persist: true },
      {
        path: "/home/agent/.persisted/data",
        persist: true,
        size: "5Gi",
        movedFrom: "/data",
      },
    ]);
    expect(patch?.spec.storageSize).toBe("15Gi");
    expect(
      patch?.annotations["agent-platform.ai/runtime-migration-mounts"],
    ).toBe(JSON.stringify({ "/data": "/home/agent/.persisted/data" }));
  });

  // TEST_SCENARIO: the refusal is checked on one read and the flip is written later. The write carries that read's resourceVersion, so a storage migration or a second request that changed the Agent in between makes the write fail with a conflict, which reads as a change to retry rather than an error.
  it("reports a write that lost a race as a concurrent update", async () => {
    const h = harness();
    h.writeMigration.mockResolvedValueOnce({ kind: "conflict" });
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
    h.writeMigration.mockResolvedValueOnce({ kind: "not-found" });
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

  // TEST_SCENARIO: an install without virtualization has no VM runner, so a switched agent would never start again.
  it("rejects when virtualization is disabled on the install", async () => {
    const h = harness({ virtualizationEnabled: false });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "VirtualizationDisabled" },
    });
    expect(h.writeMigration).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the request switches the backend in the same write that starts the migration, so a migrating Agent is already a vm Agent. A second request must say the move is under way, not that it is done.
  it("rejects while a runtime migration is already running", async () => {
    const h = harness({
      agent: infraAgent({
        spec: { name: "my-agent", image: "img", backend: { type: "vm" } },
        runtimeMigration: { phase: "copying" },
      }),
    });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "RuntimeMigrationInProgress" },
    });
    expect(h.writeMigration).not.toHaveBeenCalled();
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

  // TEST_SCENARIO: some paths cannot be linked back in a machine without breaking it: the root, one at, inside or above HOME or a path the platform lays out, one that is not a plain path even when it starts under HOME, since the copy could not place it, and one already inside HOME's persisted directory, where moved paths go. Each is refused with its reason before the agent is switched, and nothing is written.
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
            { path: "/home/agent/../srv", persist: true },
            { path: "/home/agent/./cache", persist: true },
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
      "/home/agent/../srv",
      "/home/agent/./cache",
      "/home/agent/.persisted/x",
    ]);
    expect(res.error.paths[5]?.reason).toBe("it is not a plain absolute path");
    expect(res.error.paths[0]?.reason).toContain("/etc/platform");
    expect(h.writeMigration).not.toHaveBeenCalled();
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
        spec({}),
        [{ path: "/home/agent", persist: true }],
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
      movedStorageSize(
        s,
        s.mounts ?? [],
        { "/data": "/home/agent/.persisted/data" },
        "10Gi",
      ),
    ).toBe("11Gi");
  });

  // TEST_SCENARIO: a disk never gets smaller than the Agent asks for, and a size that cannot be read leaves the disk as the Agent asks rather than guessing.
  it("never shrinks below what the agent asks, nor guesses", () => {
    const moves = { "/data": "/home/agent/.persisted/data" };
    expect(
      movedStorageSize(
        spec({ storageSize: "50Gi" }),
        [
          { path: "/home/agent", persist: true, size: "1Gi" },
          { path: "/data", persist: true, size: "1Gi" },
        ],
        moves,
        "10Gi",
      ),
    ).toBe("50Gi");
    expect(
      movedStorageSize(
        spec({}),
        [{ path: "/data", persist: true, size: "1e3" }],
        moves,
        "10Gi",
      ),
    ).toBeUndefined();
  });
});

function viewOf(
  annotations: Record<string, string>,
  spec?: object,
  virtualizationEnabled = true,
) {
  const infra = parseInfraAgent({
    metadata: { name: "agent-1", annotations },
    spec: { name: "my-agent", ...spec },
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
    { virtualizationEnabled, defaultMounts: CHART_MOUNTS },
  );
  return toAgentView(agent);
}

describe("the agent view's runtime migration", () => {
  it("is null when no migration was requested", () => {
    expect(viewOf({}).runtimeMigration).toBeNull();
  });

  it("carries the controller's phase and message", () => {
    expect(
      viewOf({
        "agent-platform.ai/runtime-migration": "copying",
        "agent-platform.ai/runtime-migration-message": "runner is full",
      }).runtimeMigration,
    ).toEqual({ phase: "copying", message: "runner is full" });
    expect(
      viewOf({ "agent-platform.ai/runtime-migration": "booting" })
        .runtimeMigration,
    ).toEqual({ phase: "booting" });
  });

  // TEST_SCENARIO: a newer controller may write a phase this api-server does not know yet; the migration is still running, so the browser must keep showing it as one.
  it("reads an unknown phase as requested", () => {
    expect(
      viewOf({ "agent-platform.ai/runtime-migration": "verifying" })
        .runtimeMigration,
    ).toEqual({ phase: "requested" });
  });

  it("offers the migration only to a container agent whose paths can all move", () => {
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
            { path: "/data", persist: true },
          ],
        },
      ).runtimeMigratable,
    ).toBe(true);
    expect(
      viewOf({}, { mounts: [{ path: "/proc/x", persist: true }] })
        .runtimeMigratable,
    ).toBe(false);
  });

  // TEST_SCENARIO: the view offers the migration from the same refusal the request checks, so the browser never offers a move the request then refuses: not while a storage migration runs, not when the install has no VM runner, not for an Agent that does not persist HOME.
  it("does not offer a migration the request would refuse", () => {
    expect(
      viewOf({ "agent-platform.ai/storage-migration": "running" })
        .runtimeMigratable,
    ).toBe(false);
    expect(viewOf({}, undefined, false).runtimeMigratable).toBe(false);
    expect(
      viewOf({}, { mounts: [{ path: "/tmp", persist: false }] })
        .runtimeMigratable,
    ).toBe(false);
  });
});

function repoHarness() {
  const { client } = fakeK8s([
    {
      metadata: {
        name: "agent-1",
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

  // TEST_SCENARIO: the merge patch carries the resourceVersion of the read the refusal was checked on, so the API server applies it only to the Agent that was checked.
  it("sends the migration's spec and annotation in one merge patch", async () => {
    const h = repoHarness();
    await h.repo.migrateBackend("agent-1", OWNER, {
      spec: { backend: { type: "vm" }, runtimeClassName: null },
      annotations: { "agent-platform.ai/runtime-migration": "requested" },
      resourceVersion: "41",
    });
    expect(h.patch).toHaveBeenCalledTimes(1);
    expect(h.patch).toHaveBeenCalledWith("agents", "agent-1", {
      metadata: {
        annotations: { "agent-platform.ai/runtime-migration": "requested" },
        resourceVersion: "41",
      },
      spec: { backend: { type: "vm" }, runtimeClassName: null },
    });
  });

  it("maps a resourceVersion conflict to a conflict outcome", async () => {
    const h = repoHarness();
    h.patch.mockRejectedValueOnce(
      Object.assign(new Error("Conflict"), { code: 409 }),
    );
    expect(
      await h.repo.migrateBackend("agent-1", OWNER, {
        spec: {},
        annotations: {},
        resourceVersion: "41",
      }),
    ).toEqual({ kind: "conflict" });
  });

  // TEST_SCENARIO: a read that carried no resourceVersion cannot condition the write, so the flip is refused as a conflict rather than sent unconditioned.
  it("refuses a flip it cannot condition on a resourceVersion", async () => {
    const h = repoHarness();
    expect(
      await h.repo.migrateBackend("agent-1", OWNER, {
        spec: {},
        annotations: {},
        resourceVersion: undefined,
      }),
    ).toEqual({ kind: "conflict" });
    expect(h.patch).not.toHaveBeenCalled();
  });

  it("does not migrate another owner's agent", async () => {
    const h = repoHarness();
    expect(
      await h.repo.migrateBackend("agent-1", "kc|someone-else", {
        spec: {},
        annotations: {},
        resourceVersion: "41",
      }),
    ).toEqual({ kind: "not-found" });
    expect(h.patch).not.toHaveBeenCalled();
  });
});

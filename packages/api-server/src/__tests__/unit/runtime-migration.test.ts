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
import { movedStorageSize } from "../../modules/agents/domain/runtime-migration.js";
import {
  assembleAgent,
  parseInfraAgent,
  type InfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";
import { runtimeFeaturesOf } from "agent-runtime-api";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { createLiveAgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import { fakeK8s } from "../helpers/fake-k8s.js";

configureLogger({ level: "error", write: () => {} });

const OWNER = "kc|owner-1";

function infraAgent(overrides?: Partial<InfraAgent>): InfraAgent {
  return {
    id: "agent-1",
    name: "my-agent",
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

function harness(opts?: {
  agent?: InfraAgent | null;
  virtualizationEnabled?: boolean;
}) {
  const agent = opts?.agent === undefined ? infraAgent() : opts.agent;
  const writeMigration = vi.fn(
    async (_id: string, _patch: RuntimeMigrationPatch) => agent,
  );
  const run = executeRuntimeMigration({
    owner: OWNER,
    virtualizationEnabled: opts?.virtualizationEnabled ?? true,
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
    });
  });

  // TEST_SCENARIO: an agent that persisted other paths on the container backend moves with them. A path under HOME keeps its place and one outside moves below HOME's persisted directory; the mounts are rewritten to match in the same write, the disk is sized for every volume together since the runner refuses a seed larger than the disk, and the controller is told where each old path went so it can find that path's volume. A non-persisted mount is left as it is.
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
          { path: "/home/agent/.persisted/data", persist: true, size: "20Gi" },
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
    h.writeMigration.mockResolvedValueOnce(null);
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

  it("rejects while a runtime migration is already running", async () => {
    const h = harness({
      agent: infraAgent({ runtimeMigration: { phase: "copying" } }),
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

  // TEST_SCENARIO: some paths cannot be linked back in a machine without breaking it: the root, one at, inside or above HOME or a path the platform lays out, one that is not a plain path, and one already inside HOME's persisted directory, where moved paths go. Each is refused with its reason before the agent is switched, and nothing is written.
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

function viewOf(annotations: Record<string, string>, spec?: object) {
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

  it("sends the migration's spec and annotation in one merge patch", async () => {
    const h = repoHarness();
    await h.repo.migrateBackend("agent-1", OWNER, {
      spec: { backend: { type: "vm" }, runtimeClassName: null },
      annotations: { "agent-platform.ai/runtime-migration": "requested" },
    });
    expect(h.patch).toHaveBeenCalledTimes(1);
    expect(h.patch).toHaveBeenCalledWith("agents", "agent-1", {
      metadata: {
        annotations: { "agent-platform.ai/runtime-migration": "requested" },
      },
      spec: { backend: { type: "vm" }, runtimeClassName: null },
    });
  });

  it("does not migrate another owner's agent", async () => {
    const h = repoHarness();
    expect(
      await h.repo.migrateBackend("agent-1", "kc|someone-else", {
        spec: {},
        annotations: {},
      }),
    ).toBeNull();
    expect(h.patch).not.toHaveBeenCalled();
  });
});

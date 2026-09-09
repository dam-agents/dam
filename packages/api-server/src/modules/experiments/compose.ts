import type { Db } from "db";
import type {
  AgentsService,
  ExperimentSandboxCreateInput,
  ExperimentsService,
} from "api-server-api";
import { createKindedAgent } from "../agents/services/kinded-agent-create.js";
import type { ArtifactLibraryServiceImpl } from "../artifact-library/index.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import { createInvocationsRepository } from "../invocations/index.js";
import { buildExperimentInstallCommand } from "./domain/install-command.js";
import { createExperimentsRepository } from "./infrastructure/experiments-repository.js";
import { createExecuteLauncher } from "./infrastructure/execute-launcher.js";
import { createDashboardSnapshotter } from "./services/dashboard-snapshot.js";
import { createExperimentsService } from "./services/experiments-service.js";
import {
  createExperimentInactivitySweep,
  type ExperimentInactivitySweep,
} from "./services/experiment-inactivity-sweep.js";
import { createExperimentDriverCleanup } from "./services/experiment-driver-cleanup.js";
import {
  cancelExperimentInvocations,
  createReapFollowUp,
  type ExperimentPinPort,
} from "./services/reap-follow-up.js";

export type { ExperimentPinPort } from "./services/reap-follow-up.js";

const FEED_INVOCATIONS_MAX = 500;

const NO_PIN: ExperimentPinPort = {
  set: async () => {},
  clear: async () => {},
};

export function composeExperimentsForOwner(opts: {
  db: Db;
  owner: string;
  surface: string;
  artifactLibrary: ArtifactLibraryServiceImpl;
  pin?: ExperimentPinPort;
  runtimeMutator?: RuntimeMutator;
  wakeAgent?: (agentId: string) => Promise<void>;
  agents: AgentsService;
}): { experiments: ExperimentsService } {
  const invocationsRepo = createInvocationsRepository(opts.db);
  const { agents, runtimeMutator, wakeAgent, owner, surface } = opts;
  const kindedRail =
    agents && runtimeMutator && wakeAgent
      ? { owner, surface, agents, runtimeMutator, wakeAgent }
      : null;
  const experiments = createExperimentsService({
    owner: opts.owner,
    surface: opts.surface,
    repo: createExperimentsRepository(opts.db),
    artifactLibrary: opts.artifactLibrary,
    snapshotDashboard: createDashboardSnapshotter({
      db: opts.db,
      artifactLibraryFor: () => opts.artifactLibrary,
    }),
    ...(opts.pin ? { pin: opts.pin } : {}),
    ...(opts.runtimeMutator && opts.wakeAgent
      ? {
          launcher: createExecuteLauncher({
            runtimeMutator: opts.runtimeMutator,
            wakeAgent: opts.wakeAgent,
          }),
        }
      : {}),
    ...(kindedRail
      ? {
          createSandbox: (input: ExperimentSandboxCreateInput) =>
            createKindedAgent(kindedRail, {
              createInput: { ...input, kind: "experiment" },
              installCommand: buildExperimentInstallCommand(),
              eventIdPrefix: "experiment-install",
              securityEvent: "experiment_sandbox.create",
            }),
        }
      : {}),
    invocationsForExperiment: async (driverAgentId, experimentId) => {
      const rows = await invocationsRepo.listByExperiment(
        driverAgentId,
        experimentId,
        FEED_INVOCATIONS_MAX,
      );
      return rows.map((row) => ({
        id: row.id,
        spanId: row.experimentSpanId?.slice(experimentId.length + 1) ?? null,
        status: row.status,
      }));
    },
    runningInvocationsByDriver: () =>
      invocationsRepo.countRunningByDriver(opts.owner),
    experimentForInvocation: async (targetAgentId) => {
      const invocation = await invocationsRepo.get(targetAgentId);
      const spanRef = invocation?.experimentSpanId;
      if (!spanRef) return null;
      return spanRef.slice(0, spanRef.indexOf("/"));
    },
    cancelInvocations: (driverAgentId, experimentId, reason) =>
      cancelExperimentInvocations({
        invocationsRepo,
        agents: opts.agents,
        driverAgentId,
        experimentId,
        reason,
      }),
  });
  return { experiments };
}

export function composeExperimentInactivitySweep(opts: {
  db: Db;
  inactivityMs: number;
  batchSize: number;
  pin: ExperimentPinPort;
  artifactLibraryFor: (owner: string) => ArtifactLibraryServiceImpl;
  agentsFor: (owner: string) => AgentsService;
}): ExperimentInactivitySweep {
  const repo = createExperimentsRepository(opts.db);
  return createExperimentInactivitySweep({
    repo,
    inactivityMs: opts.inactivityMs,
    batchSize: opts.batchSize,
    now: () => new Date(),
    onReaped: createReapFollowUp({
      ...opts,
      repo,
      reason: "experiment reaped for inactivity",
      logTag: "experiment-inactivity",
    }),
  });
}

export function createExperimentsCleanupHook(opts: {
  db: Db;
  artifactLibraryFor: (owner: string) => ArtifactLibraryServiceImpl;
  agentsFor: (owner: string) => AgentsService;
}): (agentId: string) => Promise<void> {
  const repo = createExperimentsRepository(opts.db);
  return createExperimentDriverCleanup({
    repo,
    now: () => new Date(),
    onReaped: createReapFollowUp({
      ...opts,
      repo,
      pin: NO_PIN,
      reason: "driver agent deleted",
      logTag: "experiments-cleanup",
    }),
  });
}

export function listOpenExperimentDriverIds(db: Db): Promise<string[]> {
  return createExperimentsRepository(db).listOpenDriverIds();
}

export async function reconcileExperimentPins(opts: {
  db: Db;
  listPinnedAgentIds: () => Promise<string[]>;
  pin: ExperimentPinPort;
}): Promise<{ set: number; cleared: number }> {
  const repo = createExperimentsRepository(opts.db);
  const pinned = new Set(await opts.listPinnedAgentIds());
  const running = new Set(await repo.listRunningDrivers());
  let set = 0;
  let cleared = 0;
  for (const id of running) {
    if (!pinned.has(id)) {
      await opts.pin.set(id);
      set++;
    }
  }
  for (const id of pinned) {
    if (!running.has(id) && !(await repo.hasRunningForDriver(id))) {
      await opts.pin.clear(id);
      cleared++;
    }
  }
  return { set, cleared };
}

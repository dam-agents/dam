import type { Db } from "db";
import type { AgentsService, ExperimentsService } from "api-server-api";
import type { ArtifactLibraryServiceImpl } from "../artifact-library/index.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import { createInvocationsRepository } from "../invocations/index.js";
import { createExperimentsRepository } from "./infrastructure/experiments-repository.js";
import { createExecuteLauncher } from "./infrastructure/execute-launcher.js";
import { createDashboardSnapshotter } from "./services/dashboard-snapshot.js";
import { createExperimentsService } from "./services/experiments-service.js";
import {
  createExperimentInactivitySweep,
  type ExperimentInactivitySweep,
} from "./services/experiment-inactivity-sweep.js";

/** The hibernation-pin port: set/clear the `experiment-active` annotation on
 *  the driver Agent (see agents/infrastructure/labels.ts). */
export interface ExperimentPinPort {
  set(driverAgentId: string): Promise<void>;
  clear(driverAgentId: string): Promise<void>;
}

/** Cap on invocation rows joined into one Trace Feed frame. */
const FEED_INVOCATIONS_MAX = 500;

/** Compose the owner-scoped Experiments service. Owner is bound here so the
 *  same factory backs the tRPC context and the harness REST routes without
 *  either passing an owner through request input. `artifactLibrary` must be
 *  the same owner's composition — script versions and dashboards are published
 *  into that owner's library, attributed to the driver agent. */
export function composeExperimentsForOwner(opts: {
  db: Db;
  owner: string;
  artifactLibrary: ArtifactLibraryServiceImpl;
  /** Hibernation pin; both production compositions pass it. */
  pin?: ExperimentPinPort;
  /** startRun launch rail; the tRPC composition passes both, the harness REST
   *  composition needs the pin only (finish releases it). */
  runtimeMutator?: RuntimeMutator;
  wakeAgent?: (agentId: string) => Promise<void>;
  /** For Stop's invocation cancel: reaps the failed targets eagerly (they
   *  are Sweepable, so a missed reap is caught by the Agent Sweep). */
  agents?: AgentsService;
}): { experiments: ExperimentsService } {
  const invocationsRepo = createInvocationsRepository(opts.db);
  const experiments = createExperimentsService({
    owner: opts.owner,
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
    invocationsForExperiment: async (driverAgentId, experimentId) => {
      const rows = await invocationsRepo.listByExperiment(
        driverAgentId,
        experimentId,
        FEED_INVOCATIONS_MAX,
      );
      return rows.map((row) => ({
        id: row.id,
        // Strip the "<experimentId>/" prefix back off to the SDK-side span id.
        spanId: row.experimentSpanId?.slice(experimentId.length + 1) ?? null,
        status: row.status,
      }));
    },
    runningInvocationsByDriver: () =>
      invocationsRepo.countRunningByDriver(opts.owner),
    experimentForInvocation: async (targetAgentId) => {
      // The invocation's PK is its target agent's id; the span attach
      // ("<experimentId>/<spanId>") names the run it belongs to.
      const invocation = await invocationsRepo.get(targetAgentId);
      const spanRef = invocation?.experimentSpanId;
      if (!spanRef) return null;
      return spanRef.slice(0, spanRef.indexOf("/"));
    },
    cancelInvocations: async (driverAgentId, experimentId) => {
      const failed = await invocationsRepo.failAllRunningByExperiment(
        driverAgentId,
        experimentId,
        "experiment stopped",
      );
      for (const invocationId of failed) {
        try {
          await opts.agents?.delete(invocationId);
        } catch {
          // Sweepable is the backstop — the Agent Sweep reaps it on hibernate.
        }
      }
    },
  });
  return { experiments };
}

/** Compose the boot-level inactivity sweep. Owner-agnostic (it scans every
 *  owner's experiments), so it builds its own repository. Started once. A
 *  reap releases the driver's pin when it was its last running experiment —
 *  the sweep is what un-pins a crashed loop's driver. */
export function composeExperimentInactivitySweep(opts: {
  db: Db;
  inactivityMs: number;
  intervalMs: number;
  batchSize: number;
  pin?: ExperimentPinPort;
  /** Owner-scoped library factory for the terminal dashboard snapshot. */
  artifactLibraryFor?: (owner: string) => ArtifactLibraryServiceImpl;
}): ExperimentInactivitySweep {
  const repo = createExperimentsRepository(opts.db);
  const snapshot = opts.artifactLibraryFor
    ? createDashboardSnapshotter({
        db: opts.db,
        artifactLibraryFor: opts.artifactLibraryFor,
        repo,
      })
    : null;
  return createExperimentInactivitySweep({
    repo,
    inactivityMs: opts.inactivityMs,
    intervalMs: opts.intervalMs,
    batchSize: opts.batchSize,
    onReaped: async ({
      id,
      owner,
      driverAgentId,
    }: {
      id: string;
      owner: string;
      driverAgentId: string;
    }) => {
      if (opts.pin && !(await repo.hasRunningForDriver(driverAgentId))) {
        await opts.pin.clear(driverAgentId);
      }
      if (snapshot) {
        try {
          await snapshot(id, owner);
        } catch (err) {
          process.stderr.write(
            `[experiment-inactivity] dashboard snapshot ${id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
    },
  });
}

/** Boot-time pin reconciliation: experiments survive restarts (unlike
 *  sessions), so instead of blanket-clearing, converge the annotation to the
 *  database truth — pin every driver with a running experiment, un-pin every
 *  agent carrying a stale pin. */
export async function reconcileExperimentPins(opts: {
  db: Db;
  listPinnedAgentIds: () => Promise<string[]>;
  pin: ExperimentPinPort;
}): Promise<{ set: number; cleared: number }> {
  const repo = createExperimentsRepository(opts.db);
  const running = new Set(await repo.listRunningDrivers());
  const pinned = new Set(await opts.listPinnedAgentIds());
  let set = 0;
  let cleared = 0;
  for (const id of running) {
    if (!pinned.has(id)) {
      await opts.pin.set(id);
      set++;
    }
  }
  for (const id of pinned) {
    if (!running.has(id)) {
      await opts.pin.clear(id);
      cleared++;
    }
  }
  return { set, cleared };
}

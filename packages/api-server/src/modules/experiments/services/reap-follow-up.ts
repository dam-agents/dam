import type { Db } from "db";
import type { AgentsService } from "api-server-api";
import type { ArtifactLibraryServiceImpl } from "../../artifact-library/index.js";
import { createInvocationsRepository } from "../../invocations/index.js";
import type { ExperimentsRepository } from "../infrastructure/experiments-repository.js";
import { createDashboardSnapshotter } from "./dashboard-snapshot.js";
import type { ReapedExperiment } from "./experiment-driver-cleanup.js";

export interface ExperimentPinPort {
  set(driverAgentId: string): Promise<void>;
  clear(driverAgentId: string): Promise<void>;
}

export async function cancelExperimentInvocations(deps: {
  invocationsRepo: ReturnType<typeof createInvocationsRepository>;
  agents: AgentsService;
  driverAgentId: string;
  experimentId: string;
  reason: string;
}): Promise<void> {
  const failed = await deps.invocationsRepo.failAllRunningByExperiment(
    deps.driverAgentId,
    deps.experimentId,
    deps.reason,
  );
  for (const invocationId of failed) {
    try {
      await deps.agents.delete(invocationId);
    } catch (err) {
      process.stderr.write(
        `[experiments] target reap ${invocationId} failed: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  }
}

export interface ReapFollowUpOpts {
  db: Db;
  repo: ExperimentsRepository;
  reason: string;
  logTag: string;
  pin: ExperimentPinPort;
  artifactLibraryFor: (owner: string) => ArtifactLibraryServiceImpl;
  agentsFor: (owner: string) => AgentsService;
}

export function createReapFollowUp(
  opts: ReapFollowUpOpts,
): (row: ReapedExperiment) => Promise<void> {
  const invocationsRepo = createInvocationsRepository(opts.db);
  const snapshot = createDashboardSnapshotter({
    db: opts.db,
    artifactLibraryFor: opts.artifactLibraryFor,
    repo: opts.repo,
  });
  return async ({ id, owner, driverAgentId }) => {
    try {
      await cancelExperimentInvocations({
        invocationsRepo,
        agents: opts.agentsFor(owner),
        driverAgentId,
        experimentId: id,
        reason: opts.reason,
      });
    } catch (err) {
      process.stderr.write(
        `[${opts.logTag}] invocation cancel ${id} failed: ${err instanceof Error ? err.message : err}\n`,
      );
    }
    if (!(await opts.repo.hasRunningForDriver(driverAgentId))) {
      await opts.pin.clear(driverAgentId);
    }
    try {
      await snapshot(id, owner);
    } catch (err) {
      process.stderr.write(
        `[${opts.logTag}] dashboard snapshot ${id} failed: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  };
}

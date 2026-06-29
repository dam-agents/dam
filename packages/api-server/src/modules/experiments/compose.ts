import type { Db } from "db";
import type { ExperimentsService } from "api-server-api";
import { createExperimentsRepository } from "./infrastructure/experiments-repository.js";
import { createRuntimeTrialLauncher } from "./infrastructure/trial-launcher.js";
import { createExperimentsService } from "./services/experiments-service.js";
import {
  createExperimentArmSweeper,
  type ExperimentArmSweeper,
} from "./services/experiment-arm-sweeper.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export interface ComposeExperimentsForOwnerOpts {
  db: Db;
  owner: string;
  /** Resolve whether the agent exists for this owner — gates `addArm` so an arm
   *  can only reference an owned agent. Omit in contexts without an agents
   *  service (the check is then skipped). */
  agentExists?: (agentId: string) => Promise<boolean>;
  runtimeMutator?: RuntimeMutator;
  wakeAgent?: (agentId: string) => Promise<void>;
}

/** Compose the owner-scoped Experiments service. The owner is bound here, so
 *  the same factory backs both the user tRPC router and the in-pod MCP session
 *  without either passing an owner through request input. No boot-time
 *  singleton: the service is plain db-backed CRUD with no shared worker state. */
export function composeExperimentsForOwner(
  opts: ComposeExperimentsForOwnerOpts,
): { experiments: ExperimentsService } {
  const repo = createExperimentsRepository(opts.db);
  const trialLauncher =
    opts.runtimeMutator && opts.wakeAgent
      ? createRuntimeTrialLauncher({
          runtimeMutator: opts.runtimeMutator,
          wakeAgent: opts.wakeAgent,
        })
      : undefined;
  return {
    experiments: createExperimentsService({
      owner: opts.owner,
      repo,
      ...(opts.agentExists ? { agentExists: opts.agentExists } : {}),
      ...(trialLauncher ? { trialLauncher } : {}),
    }),
  };
}

/** Compose the system-level inactivity-deadline sweep. Owner-agnostic (it scans
 *  every owner's experiments), so it builds its own repository rather than going
 *  through the per-owner service. Long-lived: started once at boot. */
export function composeExperimentArmSweeper(opts: {
  db: Db;
  inactivityMs: number;
  intervalMs: number;
  batchSize: number;
}): ExperimentArmSweeper {
  return createExperimentArmSweeper({
    repo: createExperimentsRepository(opts.db),
    inactivityMs: opts.inactivityMs,
    intervalMs: opts.intervalMs,
    batchSize: opts.batchSize,
  });
}

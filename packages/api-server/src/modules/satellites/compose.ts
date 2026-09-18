import type { Db } from "db";
import type { SatellitesService } from "api-server-api";
import {
  createSatellitesRepository,
  type SatellitesRepository,
} from "./infrastructure/satellites-repository.js";
import {
  createSatelliteAgentOps,
  JOB_TTL_MS,
  type AgentOpsDeps,
  type SatelliteAgentOpsImpl,
} from "./services/agent-ops.js";
import { createSatellitesService } from "./services/satellites-service.js";
import {
  createLeaseSweep,
  createSatelliteWorkerOps,
  type SatelliteWorkerOpsImpl,
  type WorkerOpsDeps,
} from "./services/worker-ops.js";

export interface SatellitesComposition {
  repo: SatellitesRepository;
  spillLog: AgentOpsDeps["spillLog"];
  agentOps: SatelliteAgentOpsImpl;
  workerOps: SatelliteWorkerOpsImpl;
  sweepLeases: () => Promise<number>;
  serviceFor: (
    owner: string,
    agentBinding: readonly string[] | "*",
  ) => SatellitesService;
  onAgentDeleted: (agentId: string) => Promise<void>;
  listAgentIds: () => Promise<string[]>;
  applyVerdict: (
    owner: string,
    satellite: string,
    sequence: number,
    allowed: boolean,
    reason?: string,
  ) => Promise<void>;
}

export function composeSatellitesModule(deps: {
  db: Db;
  maxConcurrentCeiling: number;
  ownerOf: AgentOpsDeps["ownerOf"];
  isAgentOwnedBy: (agentId: string, owner: string) => Promise<boolean>;
  requestApproval: AgentOpsDeps["requestApproval"];
  spillLog: AgentOpsDeps["spillLog"];
  retireApproval: AgentOpsDeps["retireApproval"];
  deliverOutcome: WorkerOpsDeps["deliverOutcome"];
}): SatellitesComposition {
  const repo = createSatellitesRepository(deps.db);

  const stopDispatch = async (
    scope: { owner?: string; satellite?: string; agentId?: string },
    reason: string,
  ): Promise<void> => {
    const settled = await repo.stopDispatch(scope, reason, JOB_TTL_MS);
    for (const job of settled) {
      if (job.approvalId !== null) await deps.retireApproval(job.approvalId);
      await deps.deliverOutcome({
        owner: job.owner,
        agentId: job.agentId,
        satellite: job.satellite,
        sequence: job.sequence,
      });
    }
  };
  const workerDeps: WorkerOpsDeps = {
    repo,
    maxConcurrentCeiling: deps.maxConcurrentCeiling,
    deliverOutcome: deps.deliverOutcome,
  };

  return {
    repo,
    spillLog: deps.spillLog,
    agentOps: createSatelliteAgentOps({
      repo,
      ownerOf: deps.ownerOf,
      requestApproval: deps.requestApproval,
      spillLog: deps.spillLog,
      retireApproval: deps.retireApproval,
    }),
    workerOps: createSatelliteWorkerOps(workerDeps),
    sweepLeases: createLeaseSweep(workerDeps),
    serviceFor: (owner, agentBinding) =>
      createSatellitesService({
        repo,
        owner,
        agentBinding,
        isAgentOwnedBy: deps.isAgentOwnedBy,
        deliverOutcome: deps.deliverOutcome,
        retireApproval: deps.retireApproval,
        stopDispatch: (scope, reason) =>
          stopDispatch({ ...scope, owner }, reason),
      }),
    onAgentDeleted: async (agentId) => {
      await repo.revokeAgentGrants(agentId);
      await stopDispatch({ agentId }, "the agent was deleted");
    },
    listAgentIds: () => repo.listGrantedAgentIds(),
    applyVerdict: async (owner, satellite, sequence, allowed, reason) => {
      if (allowed) {
        await repo.release(owner, satellite, sequence);
        return;
      }
      const settled = await repo.settle(owner, satellite, sequence, {
        status: "cancelled",
        reason: reason ?? "your human declined this command",
      });
      if (settled !== null)
        await deps.deliverOutcome({
          owner,
          agentId: settled.agentId,
          satellite,
          sequence,
        });
    },
  };
}

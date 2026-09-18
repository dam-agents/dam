import type { Db } from "db";
import type { SatellitesService } from "api-server-api";
import {
  createSatellitesRepository,
  type SatellitesRepository,
} from "./infrastructure/satellites-repository.js";
import {
  createSatelliteAgentOps,
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
  serviceFor: (owner: string) => SatellitesService;
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
  deliverOutcome: WorkerOpsDeps["deliverOutcome"];
}): SatellitesComposition {
  const repo = createSatellitesRepository(deps.db);
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
    }),
    workerOps: createSatelliteWorkerOps(workerDeps),
    sweepLeases: createLeaseSweep(workerDeps),
    serviceFor: (owner) =>
      createSatellitesService({
        repo,
        owner,
        isAgentOwnedBy: deps.isAgentOwnedBy,
        deliverOutcome: deps.deliverOutcome,
      }),
    onAgentDeleted: (agentId) => repo.revokeAgentGrants(agentId),
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

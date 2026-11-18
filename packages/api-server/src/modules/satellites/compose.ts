import type { Db } from "db";
import type { Redis } from "ioredis";
import type { SatellitesService } from "api-server-api";
import type { BlobHandoff } from "../../core/blob-handoff.js";
import type { RedisBus } from "../../core/redis-bus.js";
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
  createSatelliteFileChannel,
  type SatelliteFileChannel,
} from "./services/file-channel.js";
import {
  createLeaseSweep,
  createSatelliteWorkerOps,
  type SatelliteWorkerOpsImpl,
  type WorkerOpsDeps,
} from "./services/worker-ops.js";

export interface SatellitesComposition {
  repo: SatellitesRepository;
  fileChannel: SatelliteFileChannel;
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
}

export function composeSatellitesModule(deps: {
  db: Db;
  redis: Redis;
  bus: RedisBus;
  blobs: BlobHandoff;
  maxConcurrentCeiling: number;
  ownerOf: AgentOpsDeps["ownerOf"];
  isAgentOwnedBy: (agentId: string, owner: string) => Promise<boolean>;
  spillLog: AgentOpsDeps["spillLog"];
  deliverOutcome: WorkerOpsDeps["deliverOutcome"];
  agentName?: WorkerOpsDeps["agentName"];
}): SatellitesComposition {
  const repo = createSatellitesRepository(deps.db);
  const fileChannel = createSatelliteFileChannel({
    redis: deps.redis,
    bus: deps.bus,
    blobs: deps.blobs,
    ...(deps.agentName === undefined ? {} : { agentName: deps.agentName }),
  });

  const stopDispatch = async (
    scope: { owner?: string; satellite?: string; agentId?: string },
    reason: string,
  ): Promise<void> => {
    const settled = await repo.stopDispatch(scope, reason, JOB_TTL_MS);
    for (const job of settled) {
      try {
        await deps.deliverOutcome({
          owner: job.owner,
          agentId: job.agentId,
          satellite: job.satellite,
          sequence: job.sequence,
        });
      } catch (err) {
        console.error(
          `[satellites] ${job.satellite}#${job.sequence} was cancelled but its agent was not told`,
          err,
        );
      }
    }
  };
  const workerDeps: WorkerOpsDeps = {
    repo,
    fileChannel,
    maxConcurrentCeiling: deps.maxConcurrentCeiling,
    deliverOutcome: deps.deliverOutcome,
    ...(deps.agentName === undefined ? {} : { agentName: deps.agentName }),
  };

  return {
    repo,
    fileChannel,
    spillLog: deps.spillLog,
    agentOps: createSatelliteAgentOps({
      repo,
      ownerOf: deps.ownerOf,
      spillLog: deps.spillLog,
    }),
    workerOps: createSatelliteWorkerOps(workerDeps),
    sweepLeases: createLeaseSweep(workerDeps),
    serviceFor: (owner, agentBinding) =>
      createSatellitesService({
        repo,
        fileChannel,
        owner,
        agentBinding,
        isAgentOwnedBy: deps.isAgentOwnedBy,
        deliverOutcome: deps.deliverOutcome,
        stopDispatch: (scope, reason) =>
          stopDispatch({ ...scope, owner }, reason),
      }),
    onAgentDeleted: async (agentId) => {
      const granted = await repo.grantedNames(agentId);
      await repo.revokeAgentGrants(agentId);
      await stopDispatch({ agentId }, "the agent was deleted");
      for (const { owner, name } of granted)
        await fileChannel.revoke(owner, name, agentId);
    },
    listAgentIds: () => repo.listGrantedAgentIds(),
  };
}

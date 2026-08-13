import type { Db } from "db";
import type { AgentsService, InvocationsQueryService } from "api-server-api";
import { createExperimentsRepository } from "../experiments/infrastructure/experiments-repository.js";
import { createInvocationsRepository } from "./infrastructure/invocations-repository.js";
import {
  createInvocationsService,
  type InvocationsService,
} from "./services/invocations-service.js";
import {
  createInvocationLivenessSweep,
  type InvocationLivenessSweep,
  type TargetRestartState,
} from "./services/invocation-liveness.js";
import {
  createDriverResolution,
  type DriverResolution,
} from "./services/driver-resolution.js";
import { createDriverCascade } from "./services/driver-cascade.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export function composeInvocationsForOwner(opts: {
  db: Db;
  owner: string;
  agents: AgentsService;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
}): InvocationsService {
  const experimentsRepo = createExperimentsRepository(opts.db);
  const repo = createInvocationsRepository(opts.db);
  return createInvocationsService({
    owner: opts.owner,
    repo,
    agents: opts.agents,
    driverResolution: createDriverResolution({ repo }),
    runtimeMutator: opts.runtimeMutator,
    wakeAgent: opts.wakeAgent,
    isExperimentRunning: async (experimentId, driverAgentId) => {
      const row = await experimentsRepo.get(experimentId, opts.owner);
      return row?.status === "running" && row.driverAgentId === driverAgentId;
    },
  });
}

export function composeInvocationsQueryForOwner(opts: {
  db: Db;
  owner: string;
}): InvocationsQueryService {
  const repo = createInvocationsRepository(opts.db);
  return {
    listTargets: () => repo.listTargetsByOwner(opts.owner),
  };
}

export function composeInvocationLivenessSweep(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  readTargetRestart: (agentId: string) => Promise<TargetRestartState | null>;
  batchSize: number;
}): InvocationLivenessSweep {
  return createInvocationLivenessSweep({
    repo: createInvocationsRepository(opts.db),
    agentsFor: opts.agentsFor,
    readTargetRestart: opts.readTargetRestart,
    batchSize: opts.batchSize,
  });
}

export function createDriverResolutionAdapter(db: Db): DriverResolution {
  return createDriverResolution({ repo: createInvocationsRepository(db) });
}

export function createInvocationsCleanupHook(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
}): (agentId: string) => Promise<void> {
  return createDriverCascade({
    repo: createInvocationsRepository(opts.db),
    agentsFor: opts.agentsFor,
  });
}

export function listInvocationAgentIds(db: Db): Promise<string[]> {
  const olderThan = new Date(Date.now() - INVOCATION_ORPHAN_GRACE_MS);
  return createInvocationsRepository(db).listRunningAgentIds(olderThan);
}

const INVOCATION_ORPHAN_GRACE_MS = 5 * 60_000;

export type { DriverResolution } from "./services/driver-resolution.js";

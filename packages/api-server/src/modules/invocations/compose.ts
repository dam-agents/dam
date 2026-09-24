import type { Db } from "db";
import type { AgentsService, InvocationsQueryService } from "api-server-api";
import { createExperimentsRepository } from "../experiments/infrastructure/experiments-repository.js";
import { createInvocationsRepository } from "./infrastructure/invocations-repository.js";
import { buildDelegationTree } from "./domain/delegation-tree.js";
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
import type { TargetAdmission } from "./services/target-admission.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export function composeInvocationsForOwner(opts: {
  db: Db;
  owner: string;
  agents: AgentsService;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  targetAdmission?: TargetAdmission;
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
    ...(opts.targetAdmission ? { targetAdmission: opts.targetAdmission } : {}),
    isExperimentRunning: async (experimentId, driverAgentId) => {
      const row = await experimentsRepo.get(experimentId, opts.owner);
      return row?.status === "running" && row.driverAgentId === driverAgentId;
    },
  });
}

const DELEGATION_TREE_ROW_LIMIT = 2000;

export function composeInvocationsQueryForOwner(opts: {
  db: Db;
  owner: string;
}): InvocationsQueryService {
  const repo = createInvocationsRepository(opts.db);
  return {
    listTargets: () => repo.listTargetsByOwner(opts.owner),
    async tree({ driverAgentId, ids }) {
      const driverRow = await repo.get(driverAgentId);
      const root = driverRow?.rootDriverId ?? driverAgentId;
      const rows = await repo.listByRoot(root, DELEGATION_TREE_ROW_LIMIT);
      if (rows.length === DELEGATION_TREE_ROW_LIMIT) {
        process.stderr.write(
          `[invocations] delegation tree for ${root} hit the ${DELEGATION_TREE_ROW_LIMIT}-row limit\n`,
        );
      }
      const owned = rows.filter((r) => r.owner === opts.owner);
      return { nodes: buildDelegationTree(owned, ids) };
    },
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

export async function listInvocationAgentIds(db: Db): Promise<string[]> {
  const repo = createInvocationsRepository(db);
  const olderThan = new Date(Date.now() - INVOCATION_ORPHAN_GRACE_MS);
  const [running, roots] = await Promise.all([
    repo.listRunningAgentIds(olderThan),
    repo.listRootDriverIds(),
  ]);
  return Array.from(new Set([...running, ...roots]));
}

const INVOCATION_ORPHAN_GRACE_MS = 5 * 60_000;

export type { DriverResolution } from "./services/driver-resolution.js";

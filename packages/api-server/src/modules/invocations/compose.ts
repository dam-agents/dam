import type { Db } from "db";
import type {
  AgentsService,
  InvocationsQueryService,
  SkillsService,
} from "api-server-api";
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
import { createSetupFailure } from "./services/setup-failure.js";
import {
  createInvocationPinReconciler,
  type DriverPin,
  type InvocationPinReconciler,
} from "./services/invocation-pin.js";
import type { TargetAdmission } from "./services/target-admission.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export function composeInvocationsForOwner(opts: {
  db: Db;
  owner: string;
  agents: AgentsService;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  targetAdmission?: TargetAdmission;
  skills?: Pick<SkillsService, "applyEntries">;
  pinDriver?: (driverAgentId: string) => Promise<void>;
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
    ...(opts.skills ? { skills: opts.skills } : {}),
    ...(opts.pinDriver ? { pinDriver: opts.pinDriver } : {}),
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

export function createInvocationSetupFailure(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
}): (agentId: string, step: string, reason: string) => Promise<void> {
  return createSetupFailure({
    repo: createInvocationsRepository(opts.db),
    agentsFor: opts.agentsFor,
  });
}

export function composeInvocationPinReconciler(opts: {
  db: Db;
  listPinnedAgentIds: () => Promise<string[]>;
  pin: DriverPin;
  log?: (msg: string) => void;
}): InvocationPinReconciler {
  const repo = createInvocationsRepository(opts.db);
  return createInvocationPinReconciler({
    listRunningDriverIds: () => repo.listRunningDriverIds(),
    listPinnedAgentIds: opts.listPinnedAgentIds,
    pin: opts.pin,
    ...(opts.log ? { log: opts.log } : {}),
  });
}

export function listInvocationAgentIds(db: Db): Promise<string[]> {
  const olderThan = new Date(Date.now() - INVOCATION_ORPHAN_GRACE_MS);
  return createInvocationsRepository(db).listRunningAgentIds(olderThan);
}

const INVOCATION_ORPHAN_GRACE_MS = 5 * 60_000;

export type { DriverResolution } from "./services/driver-resolution.js";

import type { Db } from "db";
import type {
  AgentsService,
  InvocationsControlService,
  InvocationsQueryService,
  SkillsService,
} from "api-server-api";
import { createInvocationsRepository } from "./infrastructure/invocations-repository.js";
import { createDelegationControl } from "./services/delegation-control.js";
import { createInvocationOutcomesRepository } from "./infrastructure/invocation-outcomes-repository.js";
import { createDelegationsQuery } from "./services/delegations-query.js";
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
import { createTargetCapture } from "./services/target-capture.js";
import type { DelegationFramesPort } from "./services/delegation-frames.js";
import {
  createTargetReaper,
  type TargetReaper,
} from "./services/target-reaper.js";
import type { InvocationsRepository } from "./infrastructure/invocations-repository.js";
import { createSetupFailure } from "./services/setup-failure.js";
import {
  createInvocationPinReconciler,
  type InvocationPinReconciler,
} from "./services/invocation-pin.js";
import type { TargetAdmission } from "./services/target-admission.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import type { ReadHarnessConfigSupport } from "./domain/harness-config-refusal.js";
import {
  createInvocationOutcomeDelivery,
  createInvocationOutcomeWakeRetry,
  type InvocationOutcomeDeliveryDeps,
} from "./services/outcome-delivery.js";

function composeReaper(
  repo: InvocationsRepository,
  agentsFor: (owner: string) => AgentsService,
  frames: DelegationFramesPort,
): TargetReaper {
  return createTargetReaper({
    repo,
    agentsFor,
    capture: createTargetCapture({ repo, frames }),
  });
}

export function composeInvocationsForOwner(opts: {
  db: Db;
  owner: string;
  agents: AgentsService;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  frames: DelegationFramesPort;
  readHarnessConfigSupport: ReadHarnessConfigSupport;
  targetAdmission?: TargetAdmission;
  skills?: Pick<SkillsService, "applyEntries">;
  pinDriver?: (driverAgentId: string) => Promise<void>;
}): InvocationsService {
  const repo = createInvocationsRepository(opts.db);
  return createInvocationsService({
    owner: opts.owner,
    repo,
    agents: opts.agents,
    driverResolution: createDriverResolution({ repo }),
    reaper: composeReaper(repo, () => opts.agents, opts.frames),
    runtimeMutator: opts.runtimeMutator,
    wakeAgent: opts.wakeAgent,
    readHarnessConfigSupport: opts.readHarnessConfigSupport,
    ...(opts.targetAdmission ? { targetAdmission: opts.targetAdmission } : {}),
    ...(opts.skills ? { skills: opts.skills } : {}),
    ...(opts.pinDriver ? { pinDriver: opts.pinDriver } : {}),
  });
}

export function composeInvocationsQueryForOwner(opts: {
  db: Db;
  owner: string;
  frames: DelegationFramesPort;
}): InvocationsQueryService {
  return createDelegationsQuery({
    repo: createInvocationsRepository(opts.db),
    owner: opts.owner,
    frames: opts.frames,
  });
}

export function composeInvocationsControlForOwner(opts: {
  db: Db;
  owner: string;
  agents: AgentsService;
  frames: DelegationFramesPort;
}): InvocationsControlService {
  const repo = createInvocationsRepository(opts.db);
  return createDelegationControl({
    repo,
    owner: opts.owner,
    reaper: composeReaper(repo, () => opts.agents, opts.frames),
  });
}

export function composeInvocationLivenessSweep(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  readTargetRestart: (agentId: string) => Promise<TargetRestartState | null>;
  hasAgent: (agentId: string) => Promise<boolean>;
  readHarnessConfigSupport: ReadHarnessConfigSupport;
  batchSize: number;
  frames: DelegationFramesPort;
}): InvocationLivenessSweep {
  const repo = createInvocationsRepository(opts.db);
  return createInvocationLivenessSweep({
    repo,
    reaper: composeReaper(repo, opts.agentsFor, opts.frames),
    readTargetRestart: opts.readTargetRestart,
    hasAgent: opts.hasAgent,
    readHarnessConfigSupport: opts.readHarnessConfigSupport,
    batchSize: opts.batchSize,
  });
}

export function composeInvocationOutcomeDelivery(
  opts: Omit<InvocationOutcomeDeliveryDeps, "repo"> & { db: Db },
): { deliver: () => Promise<number>; retry: () => Promise<number> } {
  const deps = { ...opts, repo: createInvocationOutcomesRepository(opts.db) };
  return {
    deliver: createInvocationOutcomeDelivery(deps),
    retry: createInvocationOutcomeWakeRetry(deps),
  };
}

export interface InvocationAwaitMarks {
  markAwaited(ids: string[], until: Date): Promise<void>;
  markCollected(ids: string[]): Promise<void>;
}

export function composeInvocationAwaitMarks(
  db: Db,
): (driverAgentId: string) => InvocationAwaitMarks {
  const repo = createInvocationOutcomesRepository(db);
  return (driverAgentId) => ({
    markAwaited: (ids, until) => repo.markAwaited(driverAgentId, ids, until),
    markCollected: (ids) => repo.markCollected(driverAgentId, ids),
  });
}

export function createDriverResolutionAdapter(db: Db): DriverResolution {
  return createDriverResolution({ repo: createInvocationsRepository(db) });
}

export function createInvocationsCleanupHook(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  frames: DelegationFramesPort;
}): (agentId: string) => Promise<void> {
  const repo = createInvocationsRepository(opts.db);
  return createDriverCascade({
    repo,
    reaper: composeReaper(repo, opts.agentsFor, opts.frames),
  });
}

export function createInvocationSetupFailure(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  frames: DelegationFramesPort;
}): (agentId: string, step: string, reason: string) => Promise<string> {
  const repo = createInvocationsRepository(opts.db);
  return createSetupFailure({
    repo,
    reaper: composeReaper(repo, opts.agentsFor, opts.frames),
  });
}

export function composeInvocationPinReconciler(opts: {
  db: Db;
  listPinnedAgentIds: () => Promise<string[]>;
  readPin: (driverAgentId: string) => Promise<string | null>;
  release: (driverAgentId: string, version: string) => Promise<void>;
}): InvocationPinReconciler {
  const repo = createInvocationsRepository(opts.db);
  return createInvocationPinReconciler({
    listPinnedAgentIds: opts.listPinnedAgentIds,
    readPin: opts.readPin,
    hasRunningInvocation: async (driverAgentId) =>
      (await repo.listRunningByDriver(driverAgentId)).length > 0,
    release: opts.release,
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

import type { Db } from "db";
import type {
  AgentsService,
  InvocationsControlService,
  InvocationsQueryService,
  SkillsService,
} from "api-server-api";
import { createInvocationsRepository } from "./infrastructure/invocations-repository.js";
import { createInvocationLinks } from "./infrastructure/invocation-links.js";
import {
  createInvocationTasks,
  type InvocationTasks,
} from "./infrastructure/invocation-tasks.js";
import {
  createSpawnSessions,
  type SpawnSessions,
} from "./services/spawn-sessions.js";
import { createDelegationControl } from "./services/delegation-control.js";
import { createSubAgentOutcomesRepository } from "./infrastructure/sub-agent-outcomes-repository.js";
import { createDelegationsQuery } from "./services/delegations-query.js";
import {
  createInvocationsService,
  type InvocationsService,
} from "./services/invocations-service.js";
import type { SpendHoldGate } from "../spend/index.js";
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
import {
  createReportedTargetReap,
  type OpenCalls,
  type ReportedTargetReap,
} from "./services/reported-target-reap.js";
import type { InvocationsRepository } from "./infrastructure/invocations-repository.js";
import { createSetupFailure } from "./services/setup-failure.js";
import {
  createScriptOutputs,
  type OutputBlobStore,
  type ScriptOutputs,
} from "./services/script-outputs.js";
import {
  createInvocationPinReconciler,
  type InvocationPinReconciler,
} from "./services/invocation-pin.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import type { ReadHarnessConfigSupport } from "./domain/harness-config-refusal.js";
import {
  createSubAgentOutcomeDelivery,
  createSubAgentOutcomeWakeRetry,
  type SubAgentOutcomeDeliveryDeps,
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

function composeReportedReap(
  repo: InvocationsRepository,
  agentsFor: (owner: string) => AgentsService,
  frames: DelegationFramesPort,
  openCalls: OpenCalls,
): ReportedTargetReap {
  return createReportedTargetReap({
    reaper: composeReaper(repo, agentsFor, frames),
    capture: createTargetCapture({ repo, frames }),
    openCalls,
  });
}

export function composeInvocationsForOwner(opts: {
  db: Db;
  owner: string;
  agents: AgentsService;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  frames: DelegationFramesPort;
  openCalls: OpenCalls;
  readHarnessConfigSupport: ReadHarnessConfigSupport;
  scriptOutputsAvailable: boolean;
  spendHold?: SpendHoldGate;
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
    reportedReap: composeReportedReap(
      repo,
      () => opts.agents,
      opts.frames,
      opts.openCalls,
    ),
    runtimeMutator: opts.runtimeMutator,
    wakeAgent: opts.wakeAgent,
    readHarnessConfigSupport: opts.readHarnessConfigSupport,
    scriptOutputsAvailable: opts.scriptOutputsAvailable,
    ...(opts.spendHold ? { spendHold: opts.spendHold } : {}),
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
  runsScripts: (agentId: string) => Promise<boolean | null>;
  outputs: ScriptOutputs;
  batchSize: number;
  frames: DelegationFramesPort;
  openCalls: OpenCalls;
}): InvocationLivenessSweep {
  const repo = createInvocationsRepository(opts.db);
  return createInvocationLivenessSweep({
    repo,
    reaper: composeReaper(repo, opts.agentsFor, opts.frames),
    reportedReap: composeReportedReap(
      repo,
      opts.agentsFor,
      opts.frames,
      opts.openCalls,
    ),
    readTargetRestart: opts.readTargetRestart,
    hasAgent: opts.hasAgent,
    readHarnessConfigSupport: opts.readHarnessConfigSupport,
    runsScripts: opts.runsScripts,
    outputs: opts.outputs,
    batchSize: opts.batchSize,
  });
}

export function composeSubAgentOutcomeDelivery(
  opts: Omit<SubAgentOutcomeDeliveryDeps, "repo"> & { db: Db },
): { deliver: () => Promise<number>; retry: () => Promise<number> } {
  const deps = { ...opts, repo: createSubAgentOutcomesRepository(opts.db) };
  return {
    deliver: createSubAgentOutcomeDelivery(deps),
    retry: createSubAgentOutcomeWakeRetry(deps),
  };
}

export interface SubAgentAwaitMarks {
  markAwaited(ids: string[], until: Date): Promise<void>;
  markCollected(ids: string[]): Promise<void>;
}

export function composeSubAgentAwaitMarks(
  db: Db,
): (driverAgentId: string) => SubAgentAwaitMarks {
  const repo = createSubAgentOutcomesRepository(db);
  return (driverAgentId) => ({
    markAwaited: (ids, until) => repo.markAwaited(driverAgentId, ids, until),
    markCollected: (ids) => repo.markCollected(driverAgentId, ids),
  });
}

export function createDriverResolutionAdapter(db: Db): DriverResolution {
  return createDriverResolution({ repo: createInvocationsRepository(db) });
}

export function createSpawnSessionsAdapter(db: Db): SpawnSessions {
  return createSpawnSessions({
    driverResolution: createDriverResolutionAdapter(db),
    links: createInvocationLinks(db),
  });
}

export function createInvocationTasksAdapter(db: Db): InvocationTasks {
  return createInvocationTasks(db);
}

export function createInvocationsCleanupHook(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  frames: DelegationFramesPort;
  outputs: ScriptOutputs;
}): (agentId: string) => Promise<void> {
  const repo = createInvocationsRepository(opts.db);
  return createDriverCascade({
    repo,
    reaper: composeReaper(repo, opts.agentsFor, opts.frames),
    outputs: opts.outputs,
  });
}

export function composeScriptOutputs(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  frames: DelegationFramesPort;
  store: OutputBlobStore;
}): ScriptOutputs {
  const repo = createInvocationsRepository(opts.db);
  return createScriptOutputs({
    repo,
    store: opts.store,
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

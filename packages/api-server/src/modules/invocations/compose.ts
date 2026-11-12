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
import { createDelegationStop } from "./services/delegation-stop.js";
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
import { createRunCancel, type RunCancel } from "./services/run-cancel.js";
import {
  createReportedTargetReap,
  type OpenCalls,
  type ReportedTargetReap,
} from "./services/reported-target-reap.js";
import type { InvocationsRepository } from "./infrastructure/invocations-repository.js";
import { createSetupFailure } from "./services/setup-failure.js";
import { createInvocationStart } from "./services/invocation-start.js";
import { createInvocationEgressHold } from "./services/invocation-egress-hold.js";
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
import { createOwnerQuestions } from "./services/owner-questions.js";
import { createQuestionDeadlines } from "./services/question-deadlines.js";

const logLine = (msg: string): void => {
  process.stderr.write(`${msg}\n`);
};

function composeCancel(
  repo: InvocationsRepository,
  agentsFor: (owner: string) => AgentsService,
  runtimeMutator: RuntimeMutator,
): RunCancel {
  return createRunCancel({ repo, agentsFor, runtimeMutator });
}

function composeReaper(
  repo: InvocationsRepository,
  agentsFor: (owner: string) => AgentsService,
  frames: DelegationFramesPort,
  runtimeMutator: RuntimeMutator,
): TargetReaper {
  return createTargetReaper({
    repo,
    agentsFor,
    capture: createTargetCapture({ repo, frames }),
    cancel: composeCancel(repo, agentsFor, runtimeMutator),
  });
}

function composeReportedReap(
  repo: InvocationsRepository,
  agentsFor: (owner: string) => AgentsService,
  frames: DelegationFramesPort,
  openCalls: OpenCalls,
  runtimeMutator: RuntimeMutator,
): ReportedTargetReap {
  return createReportedTargetReap({
    reaper: composeReaper(repo, agentsFor, frames, runtimeMutator),
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
  readStartWait?: (agentId: string) => Promise<string | null>;
  // UNIT_BOUNDARY_DESCRIPTION: makes a sub-agent that asked its owner a question one that sleeps and stays until the answer, instead of one the Agent Sweep removes asleep.
  parkTarget: (agentId: string) => Promise<void>;
  keepMaxMs: number;
  idleTimeoutMaxMin: number;
}): InvocationsService {
  const repo = createInvocationsRepository(opts.db);
  const reaper = composeReaper(
    repo,
    () => opts.agents,
    opts.frames,
    opts.runtimeMutator,
  );
  return createInvocationsService({
    owner: opts.owner,
    repo,
    agents: opts.agents,
    driverResolution: createDriverResolution({ repo }),
    reaper,
    stopper: createDelegationStop({ repo, reaper }),
    cancel: composeCancel(repo, () => opts.agents, opts.runtimeMutator),
    reportedReap: composeReportedReap(
      repo,
      () => opts.agents,
      opts.frames,
      opts.openCalls,
      opts.runtimeMutator,
    ),
    questions: createOwnerQuestions({
      repo,
      runtimeMutator: opts.runtimeMutator,
      wakeAgent: opts.wakeAgent,
      hold: {
        park: opts.parkTarget,
        capture: createTargetCapture({ repo, frames: opts.frames }),
        answerWithinMaxMs: opts.keepMaxMs,
      },
      log: logLine,
    }),
    runtimeMutator: opts.runtimeMutator,
    wakeAgent: opts.wakeAgent,
    readHarnessConfigSupport: opts.readHarnessConfigSupport,
    scriptOutputsAvailable: opts.scriptOutputsAvailable,
    ...(opts.spendHold ? { spendHold: opts.spendHold } : {}),
    ...(opts.skills ? { skills: opts.skills } : {}),
    ...(opts.pinDriver ? { pinDriver: opts.pinDriver } : {}),
    ...(opts.readStartWait ? { readStartWait: opts.readStartWait } : {}),
    keepMaxMs: opts.keepMaxMs,
    idleTimeoutMaxMin: opts.idleTimeoutMaxMin,
  });
}

export function composeInvocationsQueryForOwner(opts: {
  db: Db;
  owner: string;
  frames: DelegationFramesPort;
  egressWaitingAmong?: (agentIds: readonly string[]) => Promise<Set<string>>;
}): InvocationsQueryService {
  return createDelegationsQuery({
    repo: createInvocationsRepository(opts.db),
    owner: opts.owner,
    frames: opts.frames,
    ...(opts.egressWaitingAmong && {
      egressWaitingAmong: opts.egressWaitingAmong,
    }),
  });
}

export function composeInvocationsControlForOwner(opts: {
  db: Db;
  owner: string;
  agents: AgentsService;
  frames: DelegationFramesPort;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
}): InvocationsControlService {
  const repo = createInvocationsRepository(opts.db);
  return createDelegationControl({
    repo,
    owner: opts.owner,
    questions: createOwnerQuestions({
      repo,
      runtimeMutator: opts.runtimeMutator,
      wakeAgent: opts.wakeAgent,
      log: logLine,
    }),
    stopper: createDelegationStop({
      repo,
      reaper: composeReaper(
        repo,
        () => opts.agents,
        opts.frames,
        opts.runtimeMutator,
      ),
    }),
  });
}

export function composeInvocationLivenessSweep(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  readTargetRestart: (agentId: string) => Promise<TargetRestartState | null>;
  readStartWait: (agentId: string) => Promise<string | null>;
  hasAgent: (agentId: string) => Promise<boolean>;
  readHarnessConfigSupport: ReadHarnessConfigSupport;
  runsScripts: (agentId: string) => Promise<boolean | null>;
  outputs: ScriptOutputs;
  batchSize: number;
  frames: DelegationFramesPort;
  openCalls: OpenCalls;
  runtimeMutator: RuntimeMutator;
}): InvocationLivenessSweep {
  const repo = createInvocationsRepository(opts.db);
  return createInvocationLivenessSweep({
    repo,
    reaper: composeReaper(
      repo,
      opts.agentsFor,
      opts.frames,
      opts.runtimeMutator,
    ),
    cancel: composeCancel(repo, opts.agentsFor, opts.runtimeMutator),
    reportedReap: composeReportedReap(
      repo,
      opts.agentsFor,
      opts.frames,
      opts.openCalls,
      opts.runtimeMutator,
    ),
    readTargetRestart: opts.readTargetRestart,
    readStartWait: opts.readStartWait,
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

// UNIT_BOUNDARY_DESCRIPTION: the periodic job that answers each question nobody answered in time with its sub-agent's own default.
export function composeQuestionDeadlines(opts: {
  db: Db;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  batchSize: number;
}): () => Promise<number> {
  const repo = createInvocationsRepository(opts.db);
  return createQuestionDeadlines({
    repo,
    batchSize: opts.batchSize,
    log: logLine,
    questions: createOwnerQuestions({
      repo,
      runtimeMutator: opts.runtimeMutator,
      wakeAgent: opts.wakeAgent,
      log: logLine,
    }),
  });
}

export interface SubAgentAwaitMarks {
  markAwaited(ids: string[], until: Date): Promise<void>;
  collect(ids: string[]): Promise<{ inTurn: string[] }>;
}

export function composeSubAgentAwaitMarks(
  db: Db,
): (driverAgentId: string) => SubAgentAwaitMarks {
  const repo = createSubAgentOutcomesRepository(db);
  return (driverAgentId) => ({
    markAwaited: (ids, until) => repo.markAwaited(driverAgentId, ids, until),
    collect: (ids) => repo.collect(driverAgentId, ids),
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

export function createInvocationStartAdapter(
  db: Db,
  log: (msg: string) => void,
): ReturnType<typeof createInvocationStart> {
  return createInvocationStart({ repo: createInvocationsRepository(db), log });
}

export function createInvocationEgressHoldAdapter(
  db: Db,
  waitingRules: (agentId: string) => Promise<readonly unknown[]>,
): ReturnType<typeof createInvocationEgressHold> {
  return createInvocationEgressHold({
    repo: createInvocationsRepository(db),
    waitingRules,
  });
}

// UNIT_BOUNDARY_DESCRIPTION: records the owner's answer to a child's waiting network rule on the child's invocation, for the approvals context to call when a verdict lands.
export function recordEgressAnswerAdapter(
  db: Db,
): InvocationsRepository["recordEgressAnswer"] {
  const repo = createInvocationsRepository(db);
  return (id, answer) => repo.recordEgressAnswer(id, answer);
}

export function createInvocationTasksAdapter(db: Db): InvocationTasks {
  return createInvocationTasks(db);
}

export function createInvocationsCleanupHook(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  frames: DelegationFramesPort;
  outputs: ScriptOutputs;
  runtimeMutator: RuntimeMutator;
}): (agentId: string) => Promise<void> {
  const repo = createInvocationsRepository(opts.db);
  return createDriverCascade({
    repo,
    reaper: composeReaper(
      repo,
      opts.agentsFor,
      opts.frames,
      opts.runtimeMutator,
    ),
    outputs: opts.outputs,
  });
}

export function composeScriptOutputs(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  frames: DelegationFramesPort;
  store: OutputBlobStore;
  runtimeMutator: RuntimeMutator;
}): ScriptOutputs {
  const repo = createInvocationsRepository(opts.db);
  return createScriptOutputs({
    repo,
    store: opts.store,
    reaper: composeReaper(
      repo,
      opts.agentsFor,
      opts.frames,
      opts.runtimeMutator,
    ),
  });
}

export function createInvocationSetupFailure(opts: {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  frames: DelegationFramesPort;
  runtimeMutator: RuntimeMutator;
}): (
  agentId: string,
  step: string,
  reason: string,
  runId?: string,
  sessionId?: string,
) => Promise<string> {
  const repo = createInvocationsRepository(opts.db);
  return createSetupFailure({
    repo,
    reaper: composeReaper(
      repo,
      opts.agentsFor,
      opts.frames,
      opts.runtimeMutator,
    ),
  });
}

// UNIT_BOUNDARY_DESCRIPTION: a target's answer to a request to end one of its runs: confirmed, the run's cancel mark clears and the session it ended is the run's; any other answer leaves the mark for the liveness sweep.
export function createInvocationCancelOutcome(
  db: Db,
): (runId: string, ended: boolean, sessionId?: string) => Promise<void> {
  const repo = createInvocationsRepository(db);
  return async (runId, ended, sessionId) => {
    if (sessionId) await repo.setRunSession(runId, sessionId);
    if (ended) await repo.clearCancel(runId);
  };
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

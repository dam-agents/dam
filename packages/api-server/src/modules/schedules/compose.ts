import type { ConnectionOptions } from "bullmq";
import type { Db } from "db";
import type { Redis } from "ioredis";
import type { SchedulesService } from "api-server-api";
import type { SessionChoicesValidator } from "../harness-config/index.js";
import { OnceResult } from "api-server-api";
import { emit, EventType } from "../../events.js";
import type { AgentOnceLimits } from "./services/schedules-service.js";
import { createRedisTtlStore } from "../../core/ttl-store.js";
import type { AgentActivityStamp } from "../agents/index.js";
import {
  createSchedulesRepository,
  type SchedulesRepository,
} from "./infrastructure/schedules-repository.js";
import {
  createScheduleQueue,
  startScheduleWorker,
  type ScheduleQueue,
  type RunningWorker,
} from "./infrastructure/schedule-queue.js";
import { createSchedulesService } from "./services/schedules-service.js";
import {
  createSchedulerRunner,
  type SchedulerRunner,
} from "./services/scheduler-runner.js";
import type { SpendHoldGate } from "../spend/index.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import { startResumeHeldOnceSaga } from "./sagas/resume-held-once.js";
import type { FirePair } from "../harness-config/index.js";
import type { StoredProfileResolver } from "../profiles/index.js";

const ACTIVITY_STAMP_TTL_MS = 60 * 60 * 1000;

const ONCE_RETENTION_DAYS = 30;
const DEFAULT_AGENT_ONCE_LIMITS: AgentOnceLimits = {
  maxOpen: 20,
  maxPerHour: 30,
};

export interface SchedulesBoot {
  repo: SchedulesRepository;
  queue: ScheduleQueue;
  runner: SchedulerRunner;
  worker: RunningWorker;
  agentOnceLimits: AgentOnceLimits;
  validateSessionChoices?: SessionChoicesValidator;
  /* UNIT_BOUNDARY_DESCRIPTION: a schedule names a profile of its owner's, and a
   * stored one is read as the pair it resolves to; both come from the profiles
   * module so the schedules module learns nothing else about profiles. */
  profiles: {
    resolveStored: StoredProfileResolver["resolveStored"];
    owned: (owner: string, profileId: string) => Promise<boolean>;
  };
  retentionTick(): Promise<void>;
  close(): Promise<void>;
}

export interface ComposeSchedulesAtBootOpts {
  db: Db;
  profiles: {
    resolveStored: StoredProfileResolver["resolveStored"];
    owned: (owner: string, profileId: string) => Promise<boolean>;
  };
  firePair?: FirePair;
  agentOnceLimits?: AgentOnceLimits;
  validateSessionChoices?: SessionChoicesValidator;
  bullConnection: ConnectionOptions;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<AgentActivityStamp | null>;
  ensureDefault: (agentId: string) => Promise<AgentActivityStamp | null>;
  defaultPendingAfterMove: (agentId: string) => Promise<boolean>;
  scheduleModelFor: (
    agentId: string,
    model: string,
  ) => Promise<string | undefined>;
  restoreActivity: (
    agentId: string,
    stamp: AgentActivityStamp,
  ) => Promise<void>;
  redis: Redis;
  onboardingPending?: (agentId: string) => Promise<boolean>;
  spendHold?: SpendHoldGate;
  agentDisabled: (agentId: string) => Promise<boolean>;
}

export function composeSchedulesAtBoot(
  opts: ComposeSchedulesAtBootOpts,
): SchedulesBoot {
  const log = (m: string) => process.stderr.write(`[schedules] ${m}\n`);
  const repo = createSchedulesRepository(opts.db, opts.profiles);
  const queue = createScheduleQueue(opts.bullConnection);
  const runner = createSchedulerRunner({
    ...(opts.firePair ? { firePair: opts.firePair } : {}),
    repo,
    queue,
    runtimeMutator: opts.runtimeMutator,
    wakeAgent: opts.wakeAgent,
    ensureDefault: opts.ensureDefault,
    defaultPendingAfterMove: opts.defaultPendingAfterMove,
    scheduleModelFor: opts.scheduleModelFor,
    restoreActivity: opts.restoreActivity,
    activityStamps: createRedisTtlStore<AgentActivityStamp>(
      opts.redis,
      "schedule:activity-stamp",
      ACTIVITY_STAMP_TTL_MS,
    ),
    ...(opts.onboardingPending
      ? { onboardingPending: opts.onboardingPending }
      : {}),
    ...(opts.validateSessionChoices
      ? { validateSessionChoices: opts.validateSessionChoices }
      : {}),
    ...(opts.spendHold ? { spendHold: opts.spendHold } : {}),
    agentDisabled: opts.agentDisabled,
    log,
  });
  const worker = startScheduleWorker({
    connection: opts.bullConnection,
    handler: runner.buildFireHandler(),
    log,
  });
  const resumeHeldOnce = startResumeHeldOnceSaga({ repo, queue });
  return {
    repo,
    queue,
    runner,
    worker,
    profiles: opts.profiles,
    agentOnceLimits: opts.agentOnceLimits ?? DEFAULT_AGENT_ONCE_LIMITS,
    ...(opts.validateSessionChoices
      ? { validateSessionChoices: opts.validateSessionChoices }
      : {}),
    async retentionTick() {
      const pruned = await repo.deleteFinishedOnceOlderThan(
        ONCE_RETENTION_DAYS,
        OnceResult.Delivering,
      );
      for (const row of pruned) {
        await queue.cancel(row.id);
        emit({
          type: EventType.ScheduleDeleted,
          scheduleId: row.id,
          agentId: row.agentId,
          ownerSub: row.owner,
        });
      }
      if (pruned.length > 0) log(`pruned ${pruned.length} one-time schedules`);
    },
    async close() {
      resumeHeldOnce.unsubscribe();
      await worker.close();
      await queue.close();
    },
  };
}

export function createSchedulesCleanupHook(
  boot: SchedulesBoot,
): (agentId: string) => Promise<void> {
  return async (agentId) => {
    for (const id of await boot.repo.listIdsByAgent(agentId)) {
      await boot.runner.cancel(id);
    }
    await boot.repo.deleteByAgent(agentId);
  };
}

export interface ComposeSchedulesForOwnerOpts {
  boot: SchedulesBoot;
  owner: string;
  agentBinding: readonly string[] | "*";
  agentExists?: (agentId: string) => Promise<boolean>;
}

export function composeSchedulesForOwner(opts: ComposeSchedulesForOwnerOpts): {
  schedules: SchedulesService;
  isOwnedSchedule: (scheduleId: string) => Promise<boolean>;
} {
  const { boot, owner } = opts;
  return {
    schedules: createSchedulesService({
      repo: boot.repo,
      runner: boot.runner,
      owner,
      agentBinding: opts.agentBinding,
      agentOnceLimits: boot.agentOnceLimits,
      ...(boot.validateSessionChoices
        ? { validateSessionChoices: boot.validateSessionChoices }
        : {}),
      ...(opts.agentExists ? { agentExists: opts.agentExists } : {}),
      ownedProfile: (profileId) => boot.profiles.owned(owner, profileId),
      profileIssue: async (profileId, agentId) => {
        const resolved = await boot.profiles.resolveStored({
          profileId,
          agentId,
          owner,
        });
        if (resolved === null) return "its profile is gone";
        if (resolved.unavailable !== null) return resolved.unavailable.detail;
        if (resolved.grantableProvider !== null)
          return "the provider it runs on is not attached to this agent";
        return null;
      },
    }),
    isOwnedSchedule: async (scheduleId) =>
      (await boot.repo.get(scheduleId, owner)) !== null,
  };
}

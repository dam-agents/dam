import type { ConnectionOptions } from "bullmq";
import type { Db } from "db";
import type { Redis } from "ioredis";
import type { SchedulesService } from "api-server-api";
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
import type { RuntimeMutator } from "../runtime-delivery/index.js";

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
  sessionModelChoices?: (agentId: string) => Promise<string[] | null>;
  retentionTick(): Promise<void>;
  close(): Promise<void>;
}

export interface ComposeSchedulesAtBootOpts {
  db: Db;
  agentOnceLimits?: AgentOnceLimits;
  sessionModelChoices?: (agentId: string) => Promise<string[] | null>;
  bullConnection: ConnectionOptions;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<AgentActivityStamp | null>;
  restoreActivity: (
    agentId: string,
    stamp: AgentActivityStamp,
  ) => Promise<void>;
  redis: Redis;
  onboardingPending?: (agentId: string) => Promise<boolean>;
  log?: (msg: string) => void;
}

export function composeSchedulesAtBoot(
  opts: ComposeSchedulesAtBootOpts,
): SchedulesBoot {
  const log = opts.log ?? ((m) => process.stderr.write(`[schedules] ${m}\n`));
  const repo = createSchedulesRepository(opts.db);
  const queue = createScheduleQueue(opts.bullConnection);
  const runner = createSchedulerRunner({
    repo,
    queue,
    runtimeMutator: opts.runtimeMutator,
    wakeAgent: opts.wakeAgent,
    restoreActivity: opts.restoreActivity,
    activityStamps: createRedisTtlStore<AgentActivityStamp>(
      opts.redis,
      "schedule:activity-stamp",
      ACTIVITY_STAMP_TTL_MS,
    ),
    ...(opts.onboardingPending
      ? { onboardingPending: opts.onboardingPending }
      : {}),
    log,
  });
  const worker = startScheduleWorker({
    connection: opts.bullConnection,
    handler: runner.buildFireHandler(),
    log,
  });
  return {
    repo,
    queue,
    runner,
    worker,
    agentOnceLimits: opts.agentOnceLimits ?? DEFAULT_AGENT_ONCE_LIMITS,
    ...(opts.sessionModelChoices
      ? { sessionModelChoices: opts.sessionModelChoices }
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
      ...(boot.sessionModelChoices
        ? { sessionModelChoices: boot.sessionModelChoices }
        : {}),
      ...(opts.agentExists ? { agentExists: opts.agentExists } : {}),
    }),
    isOwnedSchedule: async (scheduleId) =>
      (await boot.repo.get(scheduleId, owner)) !== null,
  };
}

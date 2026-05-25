import type { ConnectionOptions } from "bullmq";
import type { Db } from "db";
import type { SchedulesService } from "api-server-api";
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

/**
 * Boot-time wiring (ADR-053): one BullMQ-backed scheduler per replica.
 * Hold the returned `boot` for the lifetime of the process — it owns
 * the BullMQ queue + worker — and call `runner.restoreAll()` once after
 * boot to seed delayed jobs from Postgres. Per-request user-facing
 * services are built via {@link composeSchedulesForOwner} and share
 * the same runner.
 */
export interface SchedulesBoot {
  repo: SchedulesRepository;
  queue: ScheduleQueue;
  runner: SchedulerRunner;
  worker: RunningWorker;
  close(): Promise<void>;
}

export interface ComposeSchedulesAtBootOpts {
  db: Db;
  bullConnection: ConnectionOptions;
  runtimeMutator: RuntimeMutator;
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
    db: opts.db,
    runtimeMutator: opts.runtimeMutator,
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
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}

export interface ComposeSchedulesForOwnerOpts {
  boot: SchedulesBoot;
  owner: string;
  /** Optional check for cross-module agent existence — when omitted,
   *  agent existence is not validated (e.g. the MCP-side service where
   *  the agentId is the verified principal). */
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
      ...(opts.agentExists ? { agentExists: opts.agentExists } : {}),
    }),
    isOwnedSchedule: async (scheduleId) =>
      (await boot.repo.get(scheduleId, owner)) !== null,
  };
}

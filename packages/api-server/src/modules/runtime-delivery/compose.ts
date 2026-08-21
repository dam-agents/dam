import type { ConnectionOptions } from "bullmq";
import type { Db } from "db";
import type { DriverFailure, RuntimeDeliveryService } from "api-server-api";
import { getLogger } from "../../core/logger.js";
import {
  createOutboxRepo,
  createAgentsRuntimeRepo,
  type AgentsRuntimeRepo,
  type OutboxRepo,
} from "./infrastructure/outbox-repo.js";
import { createAgentRuntimeClient } from "./infrastructure/agent-runtime-client.js";
import {
  createStateQueue,
  startStateWorker,
  type RunningWorker,
  type StateQueue,
} from "./infrastructure/state-queue.js";
import {
  createStateBuilder,
  type StateBuilder,
} from "./services/state-builder.js";
import {
  createBuiltinContributions,
  type BuiltinContributions,
} from "./services/builtin-contributions.js";
import {
  createWorkerHandler,
  type IsAgentRunning,
} from "./services/worker-handler.js";
import { createCronSweep, type CronSweep } from "./services/cron-sweep.js";
import { createHelloHandler } from "./services/hello-handler.js";
import type { HarnessConfigSnapshotWriter } from "./services/snapshot-writer.js";
import {
  createRuntimeMutator,
  type RuntimeMutator,
} from "./services/runtime-mutator.js";
import {
  progressOf,
  type ContributionsProgress,
} from "./domain/outbox-progress.js";

export interface RuntimeDeliveryComposition {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  queue: StateQueue;
  worker: RunningWorker;
  sweep: CronSweep;
  hello: RuntimeDeliveryService;
  runtimeMutator: RuntimeMutator;
  stateBuilder: StateBuilder;
  builtin: BuiltinContributions;
  contributionsStatus(agentId: string): Promise<ContributionsStatus>;
  contributionsStatusMany(
    agentIds: string[],
  ): Promise<Map<string, ContributionsStatus>>;
  contributionsProgress(agentId: string): Promise<ContributionsProgress>;
}

export interface ContributionsStatus {
  settled: boolean;
  failures: DriverFailure[];
  preparingWorkspace: boolean;
}

export interface ComposeRuntimeDeliveryOpts {
  db: Db;
  namespace: string;
  bullConnection: ConnectionOptions;
  agentRunningPort: IsAgentRunning;
  snapshotWriter: HarnessConfigSnapshotWriter;
  harnessServerUrl: string;
  log?: (msg: string) => void;
}

export function composeRuntimeDelivery(
  opts: ComposeRuntimeDeliveryOpts,
): RuntimeDeliveryComposition {
  const log = opts.log ?? ((m) => getLogger().info(`[runtime] ${m}`));

  const outboxRepo = createOutboxRepo(opts.db);
  const agentsRuntimeRepo = createAgentsRuntimeRepo(opts.db);
  const builtin = createBuiltinContributions({
    harnessServerUrl: opts.harnessServerUrl,
  });
  const stateBuilder = createStateBuilder({
    db: opts.db,
    outboxRepo,
    builtin,
  });
  const queue = createStateQueue(opts.bullConnection);

  const handler = createWorkerHandler({
    outboxRepo,
    agentsRuntimeRepo,
    stateBuilder,
    agentRunningPort: opts.agentRunningPort,
    snapshotWriter: opts.snapshotWriter,
    clientFor: (agentId) => createAgentRuntimeClient(agentId, opts.namespace),
    log,
  });
  const worker = startStateWorker({
    connection: opts.bullConnection,
    handler,
    log,
  });

  const sweep = createCronSweep({
    outboxRepo,
    queue,
    agentRunningPort: opts.agentRunningPort,
    log,
  });

  const hello = createHelloHandler({
    outboxRepo,
    agentsRuntimeRepo,
    snapshotWriter: opts.snapshotWriter,
    queue,
    log,
  });

  const runtimeMutator = createRuntimeMutator({
    db: opts.db,
    outboxRepo,
    queue,
  });

  return {
    outboxRepo,
    agentsRuntimeRepo,
    queue,
    worker,
    sweep,
    hello,
    runtimeMutator,
    stateBuilder,
    builtin,
    async contributionsStatus(agentId): Promise<ContributionsStatus> {
      const [row, seeding] = await Promise.all([
        outboxRepo.getRow(agentId),
        outboxRepo.seedingAgentIds([agentId]),
      ]);
      const { settled, failures } = progressOf(row);
      return { settled, failures, preparingWorkspace: seeding.has(agentId) };
    },

    async contributionsProgress(agentId): Promise<ContributionsProgress> {
      return progressOf(await outboxRepo.getRow(agentId));
    },

    async contributionsStatusMany(
      agentIds,
    ): Promise<Map<string, ContributionsStatus>> {
      const result = new Map<string, ContributionsStatus>();
      if (agentIds.length === 0) return result;
      const [rows, seeding] = await Promise.all([
        outboxRepo.getRows(agentIds),
        outboxRepo.seedingAgentIds(agentIds),
      ]);
      const byId = new Map(rows.map((r) => [r.agentId, r]));
      for (const id of agentIds) {
        const { settled, failures } = progressOf(byId.get(id) ?? null);
        result.set(id, {
          settled,
          failures,
          preparingWorkspace: seeding.has(id),
        });
      }
      return result;
    },
  };
}

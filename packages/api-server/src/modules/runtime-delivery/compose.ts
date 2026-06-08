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
  type SecretEnvSource,
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
import {
  createRuntimeMutator,
  type RuntimeMutator,
} from "./services/runtime-mutator.js";

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
  /** Settled (`lastSettledVersion >= version`, or no row) + the drivers that failed the last settle. */
  contributionsStatus(agentId: string): Promise<ContributionsStatus>;
  /** Batched form; result includes every input id. */
  contributionsStatusMany(
    agentIds: string[],
  ): Promise<Map<string, ContributionsStatus>>;
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
  harnessServerUrl: string;
  secretEnv: SecretEnvSource;
  log?: (msg: string) => void;
}

export function composeRuntimeDelivery(
  opts: ComposeRuntimeDeliveryOpts,
): RuntimeDeliveryComposition {
  // Via Pino so apply/sweep lines carry an ISO timestamp (#695).
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
    secretEnv: opts.secretEnv,
  });
  const queue = createStateQueue(opts.bullConnection);

  const handler = createWorkerHandler({
    outboxRepo,
    agentsRuntimeRepo,
    stateBuilder,
    agentRunningPort: opts.agentRunningPort,
    clientFor: (agentId) => createAgentRuntimeClient(agentId, opts.namespace),
    log,
  });
  const worker = startStateWorker({
    connection: opts.bullConnection,
    handler,
    log,
  });

  const sweep = createCronSweep({ outboxRepo, queue, log });

  const hello = createHelloHandler({
    outboxRepo,
    agentsRuntimeRepo,
    queue,
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
      const preparingWorkspace = seeding.has(agentId);
      if (!row) return { settled: true, failures: [], preparingWorkspace };
      return {
        settled: row.lastSettledVersion >= row.version,
        failures: row.applyFailures,
        preparingWorkspace,
      };
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
        const row = byId.get(id);
        const preparingWorkspace = seeding.has(id);
        result.set(
          id,
          row
            ? {
                settled: row.lastSettledVersion >= row.version,
                failures: row.applyFailures,
                preparingWorkspace,
              }
            : { settled: true, failures: [], preparingWorkspace },
        );
      }
      return result;
    },
  };
}

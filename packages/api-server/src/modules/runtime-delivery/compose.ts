import type { ConnectionOptions } from "bullmq";
import type { Db } from "db";
import type { RuntimeDeliveryService } from "api-server-api";
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
}

export interface ComposeRuntimeDeliveryOpts {
  db: Db;
  namespace: string;
  bullConnection: ConnectionOptions;
  agentRunningPort: IsAgentRunning;
  log?: (msg: string) => void;
}

export function composeRuntimeDelivery(
  opts: ComposeRuntimeDeliveryOpts,
): RuntimeDeliveryComposition {
  const log = opts.log ?? ((m) => process.stderr.write(`[runtime] ${m}\n`));

  const outboxRepo = createOutboxRepo(opts.db);
  const agentsRuntimeRepo = createAgentsRuntimeRepo(opts.db);
  const stateBuilder = createStateBuilder({ db: opts.db, outboxRepo });
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
    stateBuilder,
  });

  const runtimeMutator = createRuntimeMutator({ outboxRepo, queue });

  return {
    outboxRepo,
    agentsRuntimeRepo,
    queue,
    worker,
    sweep,
    hello,
    runtimeMutator,
    stateBuilder,
  };
}

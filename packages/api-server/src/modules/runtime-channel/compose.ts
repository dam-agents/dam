import type { Db } from "db";
import {
  createRuntimeChannelQueues,
  type RuntimeChannelQueues,
} from "./infrastructure/bullmq-queue.js";
import { createStateOutboxRepository } from "./infrastructure/state-outbox-repository.js";
import { createSignalOutboxRepository } from "./infrastructure/signal-outbox-repository.js";
import { createRuntimeChannelClient } from "./infrastructure/runtime-channel-client.js";
import {
  createCapabilityCache,
  startRuntimeChannelWorkers,
  type RuntimeChannelWorkers,
} from "./services/runtime-channel-worker.js";
import { createCronSweep, type CronSweep } from "./services/cron-sweep.js";
import {
  createEmptyStateBuilder,
  type StateBuilder,
} from "./services/state-builder.js";
import {
  createRuntimeChannelWriter,
  type RuntimeChannelWriter,
} from "./services/runtime-channel-writer.js";
import {
  createHelloAckService,
  type HelloAckService,
} from "./services/hello-ack-service.js";

export interface RuntimeChannelSystem {
  writer: RuntimeChannelWriter;
  helloAck: HelloAckService;
  queues: RuntimeChannelQueues;
  workers: RuntimeChannelWorkers;
  sweep: CronSweep;
  /** Composite stop — closes workers and sweep but does NOT close the
   *  shared db/redis (the bootstrap owns those). */
  stop(): Promise<void>;
}

export interface ComposeRuntimeChannelDeps {
  db: Db;
  namespace: string;
  redisUrl: string;
  redisPassword?: string;
  /** Phase 1 builder is empty; later wirings inject one that reads
   *  granted connections + secrets + schedule contributions. */
  stateBuilder?: StateBuilder;
  /** Worker concurrency per replica. */
  workerConcurrency?: number;
  sweep?: {
    intervalMs?: number;
    staleMs?: number;
    batchSize?: number;
  };
  log?: (msg: string) => void;
}

export function composeRuntimeChannel(
  deps: ComposeRuntimeChannelDeps,
): RuntimeChannelSystem {
  const log = deps.log ?? (() => {});

  const stateRepo = createStateOutboxRepository(deps.db);
  const signalRepo = createSignalOutboxRepository(deps.db);
  const stateBuilder = deps.stateBuilder ?? createEmptyStateBuilder();
  const capabilityCache = createCapabilityCache();
  const client = createRuntimeChannelClient(deps.namespace);

  const queues = createRuntimeChannelQueues({
    redisUrl: deps.redisUrl,
    redisPassword: deps.redisPassword,
    concurrency: deps.workerConcurrency,
  });

  const workers = startRuntimeChannelWorkers({
    queues,
    stateRepo,
    signalRepo,
    client,
    stateBuilder,
    capabilityCache,
    log,
  });

  const sweep = createCronSweep({
    queues,
    stateRepo,
    signalRepo,
    intervalMs: deps.sweep?.intervalMs,
    staleMs: deps.sweep?.staleMs,
    batchSize: deps.sweep?.batchSize,
    log,
  });

  const writer = createRuntimeChannelWriter({
    stateRepo,
    signalRepo,
    queues,
  });

  const helloAck = createHelloAckService({
    stateRepo,
    signalRepo,
    stateBuilder,
    capabilityCache,
  });

  return {
    writer,
    helloAck,
    queues,
    workers,
    sweep,
    async stop() {
      await sweep.stop();
      await workers.close();
      await queues.close();
    },
  };
}

/** Per-agent cleanup hook fired by the agents module after a successful
 *  K8s delete. Hard-deletes outbox rows for the agent so the orphan
 *  sweeper doesn't find ghost entries. */
export function createRuntimeChannelCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  const stateRepo = createStateOutboxRepository(db);
  const signalRepo = createSignalOutboxRepository(db);
  return async (agentId) => {
    await stateRepo.deleteForAgent(agentId);
    await signalRepo.deleteForAgent(agentId);
  };
}

export type { RuntimeChannelWriter } from "./services/runtime-channel-writer.js";
export type { HelloAckService } from "./services/hello-ack-service.js";
export type { StateBuilder } from "./services/state-builder.js";

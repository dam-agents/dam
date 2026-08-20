import type { ConnectionOptions } from "bullmq";
import type { Connection } from "api-server-api";
import type { PeriodicJobs } from "../../core/periodic-jobs.js";
import type { AgentsRepository } from "../agents/infrastructure/agents-repository.js";
import { createTurnLogRepository } from "./infrastructure/turn-log-repository.js";
import {
  createTurnsQueue,
  startTurnWorker,
  type RunningTurnWorker,
} from "./infrastructure/turns-queue.js";
import {
  createModelResolver,
  type HostedModelConfig,
} from "./infrastructure/model-resolver.js";
import { createHostedPodClient } from "./infrastructure/pod-client.js";
import { createTurnRunner } from "./services/turn-runner.js";
import {
  createHostedSessionsService,
  type HostedSessionsService,
} from "./services/hosted-sessions-service.js";
import type { Db } from "db";

const TURN_STALL_SWEEP_MS = 60_000;
const TURN_STALL_CUTOFF_MS = 5 * 60_000;

export interface HostedHarnessModule {
  forOwner(owner: string): HostedSessionsService;
  startWorker(): RunningTurnWorker;
  enqueueTurn(turnId: string): Promise<void>;
  close(): Promise<void>;
}

export function composeHostedHarness(deps: {
  db: Db;
  bullConnection: ConnectionOptions;
  agentsRepo: AgentsRepository;
  listConnectionsForAgent(agentId: string): Promise<Connection[]>;
  readSecretField(ref: {
    storeId?: string;
    path: string;
    field: string;
  }): Promise<string | null>;
  modelConfig: HostedModelConfig;
  namespace: string;
  periodicJobs: PeriodicJobs;
  log: (msg: string) => void;
}): HostedHarnessModule {
  const repo = createTurnLogRepository(deps.db);
  const queue = createTurnsQueue(deps.bullConnection);
  const resolveModel = createModelResolver({
    config: deps.modelConfig,
    listConnectionsForAgent: deps.listConnectionsForAgent,
    readSecretField: deps.readSecretField,
  });

  const runner = createTurnRunner({
    repo,
    resolveModel,
    podClient: (agentId) => createHostedPodClient(agentId, deps.namespace),
    getAgent: async (agentId) => {
      const infra = await deps.agentsRepo.get(agentId);
      if (!infra || infra.harness !== "hosted") return null;
      return { id: infra.id, name: infra.name, workDir: "~/work" };
    },
    ensurePodReady: (agentId) => deps.agentsRepo.ensureReady(agentId),
    log: deps.log,
  });

  void deps.periodicJobs.register(
    "hosted-turn-sweep",
    TURN_STALL_SWEEP_MS,
    async () => {
      const cutoff = new Date(Date.now() - TURN_STALL_CUTOFF_MS);
      const stalled = await repo.listRunningTurnsStalledSince(cutoff);
      for (const turn of stalled) {
        deps.log(`[hosted-turn-sweep] re-enqueueing stalled turn ${turn.id}`);
        await queue.enqueue(turn.id);
      }
    },
  );

  return {
    forOwner(owner) {
      return createHostedSessionsService({
        repo,
        queue,
        owner,
        isOwnedHostedAgent: async (agentId) => {
          const infra = await deps.agentsRepo.get(agentId, owner);
          return infra != null && infra.harness === "hosted";
        },
      });
    },
    startWorker() {
      return startTurnWorker({
        connection: deps.bullConnection,
        handler: (turnId) => runner.runTurn(turnId),
        log: deps.log,
      });
    },
    enqueueTurn: (turnId) => queue.enqueue(turnId),
    close: () => queue.close(),
  };
}

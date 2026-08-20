import { randomUUID } from "node:crypto";
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

export interface HostedScheduleFireInput {
  agentId: string;
  owner: string;
  scheduleId: string;
  task: string;
  sessionMode: "fresh" | "continuous";
}

export interface HostedHarnessModule {
  forOwner(owner: string): HostedSessionsService;
  startWorker(): RunningTurnWorker;
  enqueueTurn(turnId: string): Promise<void>;
  scheduleFire(input: HostedScheduleFireInput): Promise<{ sessionId: string }>;
  agentHarness(agentId: string): Promise<"pod" | "hosted">;
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

    async scheduleFire(input) {
      let session =
        input.sessionMode === "continuous"
          ? (await repo.listSessions(input.agentId))
              .filter((s) => s.scheduleId === input.scheduleId)
              .at(-1)
          : undefined;
      if (!session) {
        const id = `hs-${randomUUID()}`;
        await repo.createSession({
          id,
          agentId: input.agentId,
          owner: input.owner,
          scheduleId: input.scheduleId,
        });
        session = (await repo.getSession(id)) ?? undefined;
      }
      if (!session) throw new Error("failed to create schedule session");
      if (await repo.runningTurnForSession(session.id)) {
        throw new Error("previous scheduled turn still running");
      }
      const turnId = `ht-${randomUUID()}`;
      await repo.createTurn({
        id: turnId,
        sessionId: session.id,
        agentId: input.agentId,
      });
      await repo.appendEvent({
        sessionId: session.id,
        turnId,
        seq: 0,
        kind: "user-message",
        payload: { text: input.task, source: "schedule" },
      });
      await queue.enqueue(turnId);
      return { sessionId: session.id };
    },

    async agentHarness(agentId) {
      const infra = await deps.agentsRepo.get(agentId);
      return infra?.harness === "hosted" ? "hosted" : "pod";
    },

    close: () => queue.close(),
  };
}

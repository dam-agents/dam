import { randomUUID } from "node:crypto";
import type { ConnectionOptions } from "bullmq";
import {
  runtimeFeaturesOf,
  workspaceMutationEventKinds,
  type RuntimeFeatures,
} from "agent-runtime-api";
import type { Db } from "db";
import type {
  ContributionKind,
  DriverFailure,
  RuntimeDeliveryService,
  WorkspaceFailure,
  WorkspaceMutationKind,
  EnvVar,
} from "api-server-api";
import { getLogger } from "../../core/logger.js";
import { createUnitOfWork } from "../../core/unit-of-work.js";
import {
  createOutboxRepo,
  createAgentsRuntimeRepo,
  type AgentsRuntimeRepo,
  type OutboxRepo,
  type OutboxRow,
} from "./infrastructure/outbox-repo.js";
import { createAgentRuntimeClient } from "./infrastructure/agent-runtime-client.js";
import {
  createStateQueue,
  startStateWorker,
  type RunningWorker,
  type StateQueue,
} from "./infrastructure/state-queue.js";
import { createStateBuilder } from "./services/state-builder.js";
import { createBuiltinContributions } from "./services/builtin-contributions.js";
import {
  createWorkerHandler,
  type IsAgentRunning,
  type PendingEventResolver,
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
import type { EventOutcomeHandler } from "./services/hello-handler.js";
import {
  createEventLifecycleNotifier,
  ownerForEvent,
  type EventLifecycleListener,
} from "./services/event-lifecycle.js";
import { createEventOutcomeRegistry } from "./services/event-outcome-registry.js";
import {
  createSessionMessages,
  SESSION_MESSAGE_KIND,
  type SessionMessages,
} from "./services/session-messages.js";
import { emit, EventType } from "../../events.js";
import { workspaceEvent } from "./domain/outbox-events.js";
import { createEgressRuleMatchAdapter } from "../egress-rules/compose.js";

export interface RuntimeDeliveryComposition {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  queue: StateQueue;
  worker: RunningWorker;
  sweep: CronSweep;
  hello: RuntimeDeliveryService;
  runtimeMutator: RuntimeMutator;
  sessionMessages: SessionMessages;
  contributionsStatus(agentId: string): Promise<ContributionsStatus>;
  runtimeFeaturesMany(
    agentIds: string[],
  ): Promise<Map<string, RuntimeFeatures>>;
  contributionsStatusMany(
    agentIds: string[],
  ): Promise<Map<string, ContributionsStatus>>;
  contributionsProgress(agentId: string): Promise<ContributionsProgress>;
  retryWorkspaceMutation(
    agentId: string,
    kind: WorkspaceMutationKind,
  ): Promise<boolean>;
  registerEventOutcomeHandler(kind: string, handler: EventOutcomeHandler): void;
  registerEventLifecycleListener(
    kind: string,
    listener: EventLifecycleListener,
  ): void;
}

export interface ContributionsStatus {
  settled: boolean;
  failures: DriverFailure[];
  preparingWorkspace: boolean;
  workspaceFailures: WorkspaceFailure[];
  features: RuntimeFeatures;
  unsupportedKinds: ContributionKind[];
}

function statusOf(
  agentId: string,
  row: OutboxRow | null,
  preparing: ReadonlySet<string>,
  features: ReadonlyMap<string, RuntimeFeatures>,
  workspace: ReadonlyMap<string, WorkspaceFailure[]>,
): ContributionsStatus {
  const { settled, failures } = progressOf(row);
  return {
    settled,
    failures,
    preparingWorkspace: preparing.has(agentId),
    workspaceFailures: workspace.get(agentId) ?? [],
    features: features.get(agentId) ?? runtimeFeaturesOf(null),
    unsupportedKinds: row?.droppedContributionKinds ?? [],
  };
}

export interface ComposeRuntimeDeliveryOpts {
  db: Db;
  namespace: string;
  bullConnection: ConnectionOptions;
  agentRunningPort: IsAgentRunning;
  snapshotWriter: HarnessConfigSnapshotWriter;
  harnessServerUrl: string;
  telemetryEnv: (harness: string) => readonly EnvVar[];
  resolveOwner: (agentId: string) => Promise<string | null>;
  resolveAgentName: (agentId: string) => Promise<string | null>;
  resolveEvent?: PendingEventResolver;
  deliveryConcurrency: number;
}

export function composeRuntimeDelivery(
  opts: ComposeRuntimeDeliveryOpts,
): RuntimeDeliveryComposition {
  const log = (m: string) => getLogger().info(`[runtime] ${m}`);

  const outboxRepo = createOutboxRepo(opts.db);
  const agentsRuntimeRepo = createAgentsRuntimeRepo(opts.db);
  const builtin = createBuiltinContributions({
    harnessServerUrl: opts.harnessServerUrl,
    telemetryEnv: opts.telemetryEnv,
  });
  const egressRules = createEgressRuleMatchAdapter(opts.db);
  const stateBuilder = createStateBuilder({
    db: opts.db,
    outboxRepo,
    builtin,
    agentName: opts.resolveAgentName,
    egressDenies: (agentId) => async (host, method, path) =>
      (await egressRules.match(agentId, host, 443, true, method, path))
        ?.verdict === "deny",
  });
  const queue = createStateQueue(opts.bullConnection);

  const lifecycleListeners = new Map<string, EventLifecycleListener>();
  const notifyLifecycle = createEventLifecycleNotifier(
    (kind) => lifecycleListeners.get(kind),
    log,
  );

  const handler = createWorkerHandler({
    outboxRepo,
    agentsRuntimeRepo,
    stateBuilder,
    agentRunningPort: opts.agentRunningPort,
    snapshotWriter: opts.snapshotWriter,
    clientFor: (agentId) => createAgentRuntimeClient(agentId, opts.namespace),
    resolveOwner: opts.resolveOwner,
    notifyLifecycle,
    ...(opts.resolveEvent && { resolveEvent: opts.resolveEvent }),
    log,
  });
  const worker = startStateWorker({
    connection: opts.bullConnection,
    handler,
    concurrency: opts.deliveryConcurrency,
    log,
  });

  const sweep = createCronSweep({
    outboxRepo,
    queue,
    agentRunningPort: opts.agentRunningPort,
    notifyLifecycle,
    log,
  });

  const eventOutcomes = createEventOutcomeRegistry({ log });
  for (const kind of workspaceMutationEventKinds)
    eventOutcomes.add(kind, async (event) => {
      const ownerSub = await ownerForEvent(
        event.agentId,
        opts.resolveOwner,
        log,
        `${event.agentId}: workspace-mutation hint failed`,
      );
      emit({
        type: EventType.AgentUpdated,
        agentId: event.agentId,
        ...(ownerSub ? { ownerSub } : {}),
      });
    });

  const hello = createHelloHandler({
    outboxRepo,
    agentsRuntimeRepo,
    snapshotWriter: opts.snapshotWriter,
    stateBuilder,
    queue,
    uow: createUnitOfWork(opts.db),
    resolveOwner: opts.resolveOwner,
    eventOutcomeHandler: eventOutcomes.dispatch,
    log,
  });

  const runtimeMutator = createRuntimeMutator({
    db: opts.db,
    outboxRepo,
    queue,
  });

  const sessionMessages = createSessionMessages({
    runtimeMutator,
    readCapabilities: async (agentId) =>
      (await agentsRuntimeRepo.get(agentId))?.runtimeCapabilities ?? null,
    newId: randomUUID,
    log,
  });
  eventOutcomes.add(SESSION_MESSAGE_KIND, sessionMessages.onOutcome);
  lifecycleListeners.set(SESSION_MESSAGE_KIND, sessionMessages.onLifecycle);

  return {
    registerEventOutcomeHandler: eventOutcomes.add,
    registerEventLifecycleListener: (kind, listener) => {
      lifecycleListeners.set(kind, listener);
    },
    outboxRepo,
    agentsRuntimeRepo,
    queue,
    worker,
    sweep,
    hello,
    runtimeMutator,
    sessionMessages,
    async contributionsStatus(agentId): Promise<ContributionsStatus> {
      const [row, preparing, features, workspace] = await Promise.all([
        outboxRepo.getRow(agentId),
        outboxRepo.preparingWorkspaceAgentIds([agentId]),
        outboxRepo.runtimeFeaturesMany([agentId]),
        outboxRepo.workspaceFailures([agentId]),
      ]);
      return statusOf(agentId, row, preparing, features, workspace);
    },

    async retryWorkspaceMutation(agentId, kind): Promise<boolean> {
      const latest = await outboxRepo.latestWorkspaceEvent(agentId, kind);
      if (!latest) return false;
      await runtimeMutator.bump(agentId, [
        workspaceEvent(kind, kind, agentId, latest.payload, new Date()),
      ]);
      await runtimeMutator.enqueueAfterCommit(agentId);
      return true;
    },

    async runtimeFeaturesMany(agentIds): Promise<Map<string, RuntimeFeatures>> {
      const features = await outboxRepo.runtimeFeaturesMany(agentIds);
      return new Map(
        agentIds.map((id) => [id, features.get(id) ?? runtimeFeaturesOf(null)]),
      );
    },

    async contributionsProgress(agentId): Promise<ContributionsProgress> {
      return progressOf(await outboxRepo.getRow(agentId));
    },

    async contributionsStatusMany(
      agentIds,
    ): Promise<Map<string, ContributionsStatus>> {
      const result = new Map<string, ContributionsStatus>();
      if (agentIds.length === 0) return result;
      const [rows, preparing, features, workspace] = await Promise.all([
        outboxRepo.getRows(agentIds),
        outboxRepo.preparingWorkspaceAgentIds(agentIds),
        outboxRepo.runtimeFeaturesMany(agentIds),
        outboxRepo.workspaceFailures(agentIds),
      ]);
      const byId = new Map(rows.map((r) => [r.agentId, r]));
      for (const id of agentIds) {
        result.set(
          id,
          statusOf(id, byId.get(id) ?? null, preparing, features, workspace),
        );
      }
      return result;
    },
  };
}

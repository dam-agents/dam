import type {
  OutboxRepo,
  AgentsRuntimeRepo,
} from "../infrastructure/outbox-repo.js";
import type { AgentRuntimeClient } from "../infrastructure/agent-runtime-client.js";
import type { StateBuilder } from "./state-builder.js";
import type { HarnessConfigSnapshotWriter } from "./snapshot-writer.js";
import type { DriverFailure } from "api-server-api";
import type { HarnessConfigCurrent } from "agent-runtime-api";
import { emit, EventType } from "../../../events.js";
import { isWorkspaceMutationKind } from "../domain/workspace-mutation.js";

export interface IsAgentRunning {
  isRunning(agentId: string): Promise<boolean>;
}

export interface WorkerHandlerDeps {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  stateBuilder: StateBuilder;
  agentRunningPort: IsAgentRunning;
  snapshotWriter: HarnessConfigSnapshotWriter;
  clientFor(agentId: string): AgentRuntimeClient;
  resolveOwner: (agentId: string) => Promise<string | null>;
  log: (msg: string) => void;
}

export type WorkerHandler = (
  agentId: string,
  opts?: { retryUntilReady?: boolean },
) => Promise<void>;

export function createWorkerHandler(deps: WorkerHandlerDeps): WorkerHandler {
  async function emitWorkspaceMutationSettled(agentId: string): Promise<void> {
    try {
      const ownerSub = await deps.resolveOwner(agentId);
      if (ownerSub) {
        emit({ type: EventType.WorkspaceMutationSettled, agentId, ownerSub });
      }
    } catch (err) {
      deps.log(
        `[runtime-worker] ${agentId}: workspace-mutation hint failed: ${(err as Error).message}`,
      );
    }
  }

  return async (agentId: string, opts?: { retryUntilReady?: boolean }) => {
    const row = await deps.outboxRepo.getRow(agentId);
    if (!row) return;

    if (!(await deps.agentRunningPort.isRunning(agentId))) {
      if (opts?.retryUntilReady) {
        throw new Error(`${agentId}: not Ready yet — retrying until Ready`);
      }
      deps.log(
        `[runtime-worker] ${agentId}: agent not Ready; deferring to sweep`,
      );
      return;
    }

    const runtimeState = await deps.agentsRuntimeRepo.get(agentId);
    if (!runtimeState?.runtimeCapabilities) {
      deps.log(`[runtime-worker] ${agentId}: no capabilities yet; deferring`);
      return;
    }

    const capabilities = runtimeState.runtimeCapabilities as {
      contributions: never;
      events: never;
    };
    const payload = await deps.stateBuilder.build(agentId, {
      contributions: capabilities.contributions,
      events: capabilities.events,
    });

    if (payload.droppedContributionKinds.length > 0) {
      deps.log(
        `[runtime-worker] ${agentId}: dropped contributions for kinds ${payload.droppedContributionKinds.join(",")} (capability gap)`,
      );
    }
    if (payload.droppedEventKinds.length > 0) {
      deps.log(
        `[runtime-worker] ${agentId}: dropped events for kinds ${payload.droppedEventKinds.join(",")} (capability gap)`,
      );
      const droppedMutationKinds = payload.droppedEventKinds.filter(
        isWorkspaceMutationKind,
      );
      const undeliverable = await deps.outboxRepo.markEventsUndeliverable(
        agentId,
        droppedMutationKinds,
      );
      if (undeliverable > 0) {
        deps.log(
          `[runtime-worker] ${agentId}: marked ${undeliverable} workspace-mutation events undeliverable (kinds ${droppedMutationKinds.join(",")})`,
        );
        await emitWorkspaceMutationSettled(agentId);
      }
    }

    const client = deps.clientFor(agentId);
    const outcome = await client.applyState({
      version: row.version,
      state: { contributions: payload.contributions, hash: payload.hash },
      events: payload.events,
    });

    let settle: {
      appliedVersion: number;
      appliedHash: string | null;
      failures: DriverFailure[];
      settledEventIds: string[];
    };
    const reported: HarnessConfigCurrent | undefined =
      outcome.harnessConfigCurrent;
    switch (outcome.status) {
      case "stale":
        deps.log(
          `[runtime-worker] ${agentId}: agent at v${outcome.appliedVersion} ≥ v${row.version} — reconciling settled cursor`,
        );
        settle = {
          appliedVersion: row.version,
          appliedHash: payload.hash,
          failures: [],
          settledEventIds: outcome.settledEvents,
        };
        break;
      case "ok":
        settle = {
          appliedVersion: outcome.appliedVersion,
          appliedHash: outcome.appliedHash,
          failures: outcome.failures,
          settledEventIds: outcome.settledEvents,
        };
        break;
      default: {
        const _exhaustive: never = outcome;
        throw new Error(
          `unhandled applyState status: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }

    const { newlyFailed, recovered, gaveUp, eventsGaveUp } =
      await deps.outboxRepo.recordOutcome(agentId, row.version, {
        ...settle,
        deliveredEventIds: payload.events.map((e) => e.id),
      });

    for (const e of eventsGaveUp) {
      deps.log(
        `[runtime-worker] ${agentId}: event ${e.id} (${e.kind}) gave up — marked dispatched with error`,
      );
    }

    const settledIds = new Set(settle.settledEventIds);
    const workspaceMutationSettled = payload.events.some(
      (e) => settledIds.has(e.id) && isWorkspaceMutationKind(e.kind),
    );
    if (workspaceMutationSettled || eventsGaveUp.length > 0) {
      await emitWorkspaceMutationSettled(agentId);
    }

    if (reported) {
      try {
        await deps.snapshotWriter.merge(agentId, reported, { confirmed: true });
      } catch (err) {
        deps.log(
          `[runtime-worker] ${agentId}: harness-config snapshot write failed: ${(err as Error).message}`,
        );
      }
    }

    for (const f of newlyFailed) {
      emit({
        type: EventType.ContributionApplyFailed,
        agentId,
        kind: f.kind,
        message: f.message,
      });
    }
    for (const kind of recovered) {
      emit({ type: EventType.ContributionRecovered, agentId, kind });
    }
    for (const f of gaveUp) {
      emit({
        type: EventType.ContributionApplyGaveUp,
        agentId,
        kind: f.kind,
        message: f.message,
      });
    }
  };
}

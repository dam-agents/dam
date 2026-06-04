import type {
  OutboxRepo,
  AgentsRuntimeRepo,
} from "../infrastructure/outbox-repo.js";
import type { AgentRuntimeClient } from "../infrastructure/agent-runtime-client.js";
import type { StateBuilder } from "./state-builder.js";
import type { DriverFailure } from "api-server-api";
import { emit, EventType } from "../../../events.js";

export interface IsAgentRunning {
  /** True when the agent's pod is servable (Ready ∧ not terminating) — the apply may land. */
  isRunning(agentId: string): Promise<boolean>;
}

export interface WorkerHandlerDeps {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  stateBuilder: StateBuilder;
  agentRunningPort: IsAgentRunning;
  clientFor(agentId: string): AgentRuntimeClient;
  log: (msg: string) => void;
}

export type WorkerHandler = (agentId: string) => Promise<void>;

export function createWorkerHandler(deps: WorkerHandlerDeps): WorkerHandler {
  return async (agentId: string) => {
    const row = await deps.outboxRepo.getRow(agentId);
    if (!row) return;

    // Don't dispatch to a pod that isn't servable (not Ready, or terminating): the
    // row stays unsettled, so the sweep re-dispatches once a healthy pod is live.
    if (!(await deps.agentRunningPort.isRunning(agentId))) {
      deps.log(
        `[runtime-worker] ${agentId}: pod not servable; deferring to sweep`,
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
    }

    const client = deps.clientFor(agentId);
    const outcome = await client.applyState({
      version: row.version,
      state: { contributions: payload.contributions, hash: payload.hash },
      events: payload.events,
    });

    // Dispatch on the typed outcome; a genuine error (network, bug) just propagates to BullMQ retry.
    let settle: {
      appliedVersion: number;
      appliedHash: string | null;
      failures: DriverFailure[];
      settledEventIds: string[];
    };
    switch (outcome.status) {
      case "stale":
        // Agent already at ≥ this version (lost ack); reconcile the cursor and settle every event we sent (it's caught up).
        deps.log(
          `[runtime-worker] ${agentId}: agent at v${outcome.appliedVersion} ≥ v${row.version} — reconciling settled cursor`,
        );
        settle = {
          appliedVersion: row.version,
          appliedHash: payload.hash,
          failures: [],
          settledEventIds: payload.events.map((e) => e.id),
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

    // recordOutcome diffs under a row lock and returns the transitions; emit post-commit.
    const { newlyFailed, recovered, gaveUp } =
      await deps.outboxRepo.recordOutcome(agentId, row.version, settle);
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

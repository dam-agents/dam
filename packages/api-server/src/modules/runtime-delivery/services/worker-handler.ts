import type {
  OutboxRepo,
  AgentsRuntimeRepo,
} from "../infrastructure/outbox-repo.js";
import type { AgentRuntimeClient } from "../infrastructure/agent-runtime-client.js";
import type { StateBuilder } from "./state-builder.js";
import type { DriverFailure } from "api-server-api";
import { emit, EventType } from "../../../events.js";

export interface IsAgentRunning {
  /** True when the agent is Ready (controller-published condition) — the apply may land. */
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

export type WorkerHandler = (
  agentId: string,
  opts?: { retryUntilReady?: boolean },
) => Promise<void>;

export function createWorkerHandler(deps: WorkerHandlerDeps): WorkerHandler {
  return async (agentId: string, opts?: { retryUntilReady?: boolean }) => {
    const row = await deps.outboxRepo.getRow(agentId);
    if (!row) return;

    // Not Ready: hello-triggered jobs re-check on a tight cadence until Ready; others defer to the sweep.
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
        // Contributions already at ≥ this version; reconcile the cursor. Events carry their own version, so settle only the ones the agent reports it actually ran.
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

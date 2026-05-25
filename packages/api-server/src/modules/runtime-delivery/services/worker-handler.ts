import type {
  OutboxRepo,
  AgentsRuntimeRepo,
} from "../infrastructure/outbox-repo.js";
import type { AgentRuntimeClient } from "../infrastructure/agent-runtime-client.js";
import type { StateBuilder } from "./state-builder.js";

/**
 * Worker handler — what runs when BullMQ dispatches a `state:<agentId>`
 * job (ADR-053). The handler is a pure transport role: read truth from
 * Postgres, push to the agent, stamp the cursor.
 *
 * Lifecycle decisions:
 *   - No outbox row → no-op (the queue may carry stale jobIds across
 *     deletes/restarts).
 *   - Agent not running → exit clean. The cron sweep re-enqueues; the
 *     agent's own `hello` clears the row on wake.
 *   - applyState throws → re-throw so BullMQ schedules a retry.
 *   - applyState rejects with stale-version → log and clear; another
 *     replica's newer dispatch already won the race.
 */

export interface IsAgentRunning {
  isRunning(agentId: string): boolean;
}

export interface WorkerHandlerDeps {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  stateBuilder: StateBuilder;
  agentRunningPort: IsAgentRunning;
  /**
   * Per-agent client factory. The pod's URL is derived from the agent id;
   * one client per call is cheap (it's just an HTTP wrapper).
   */
  clientFor(agentId: string): AgentRuntimeClient;
  log: (msg: string) => void;
}

export type WorkerHandler = (agentId: string) => Promise<void>;

export function createWorkerHandler(deps: WorkerHandlerDeps): WorkerHandler {
  return async (agentId: string) => {
    const row = await deps.outboxRepo.getRow(agentId);
    if (!row) return;

    if (!deps.agentRunningPort.isRunning(agentId)) {
      // Defer to the sweep + hello catch-up path. Don't throw — BullMQ
      // retries are reserved for transport failures.
      return;
    }

    const runtimeState = await deps.agentsRuntimeRepo.get(agentId);
    if (!runtimeState?.runtimeCapabilities) {
      // Agent hasn't said hello yet — first thing it'll do on boot. Sweep
      // will re-enqueue if needed.
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
    let result;
    try {
      result = await client.applyState({
        version: row.version,
        state: { contributions: payload.contributions, hash: payload.hash },
        events: payload.events,
      });
    } catch (err) {
      // Stale-version CONFLICT means another replica's newer dispatch
      // beat us — fine, the winning ack already advanced the cursor.
      const msg = (err as Error).message ?? String(err);
      if (msg.includes("stale apply")) {
        deps.log(
          `[runtime-worker] ${agentId}: stale dispatch dropped — ${msg}`,
        );
        return;
      }
      throw err;
    }

    await deps.outboxRepo.stampAck(
      agentId,
      result.appliedVersion,
      result.appliedHash,
    );
  };
}

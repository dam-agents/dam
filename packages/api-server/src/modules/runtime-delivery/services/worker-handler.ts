import type {
  OutboxRepo,
  AgentsRuntimeRepo,
} from "../infrastructure/outbox-repo.js";
import type { AgentRuntimeClient } from "../infrastructure/agent-runtime-client.js";
import type { StateBuilder } from "./state-builder.js";

export interface IsAgentRunning {
  isRunning(agentId: string): boolean;
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

    if (!deps.agentRunningPort.isRunning(agentId)) {
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
    let result;
    try {
      result = await client.applyState({
        version: row.version,
        state: { contributions: payload.contributions, hash: payload.hash },
        events: payload.events,
      });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (msg.includes("stale apply")) {
        deps.log(
          `[runtime-worker] ${agentId}: stale dispatch dropped — ${msg}`,
        );
        return;
      }
      if (msg.includes("apply failed for")) {
        deps.log(
          `[runtime-worker] ${agentId}: driver failure on v=${row.version} — not acking, will retry: ${msg}`,
        );
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

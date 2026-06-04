import type {
  HelloInput,
  HelloResult,
  RuntimeDeliveryService,
} from "api-server-api";
import type {
  AgentsRuntimeRepo,
  OutboxRepo,
} from "../infrastructure/outbox-repo.js";
import type { StateQueue } from "../infrastructure/state-queue.js";

/** Presence ping + worker enqueue when the outbox is ahead of the agent. */
export function createHelloHandler(deps: {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  queue: StateQueue;
}): RuntimeDeliveryService {
  return {
    async hello(agentId: string, input: HelloInput): Promise<HelloResult> {
      await deps.agentsRuntimeRepo.upsertHello({
        agentId,
        protocolVersion: input.protocolVersion,
        capabilities: input.capabilities,
        agentRuntimeVersion: input.agentRuntimeVersion,
      });

      const row = await deps.outboxRepo.getRow(agentId);
      if (row && row.version > (input.lastAppliedVersion ?? 0)) {
        await deps.queue.enqueue(agentId);
      }
      return { events: [] };
    },
  };
}

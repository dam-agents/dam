import type {
  HelloInput,
  HelloResult,
  RuntimeDeliveryService,
} from "api-server-api";
import type {
  AgentsRuntimeRepo,
  OutboxRepo,
} from "../infrastructure/outbox-repo.js";
import type { StateBuilder } from "./state-builder.js";

export function createHelloHandler(deps: {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  stateBuilder: StateBuilder;
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
      if (!row || row.version === 0) {
        return { events: [] };
      }

      const payload = await deps.stateBuilder.build(
        agentId,
        input.capabilities,
      );
      const divergedVersion = row.version > (input.lastAppliedVersion ?? 0);
      const divergedHash = payload.hash !== (input.lastAppliedHash ?? null);
      const hasEvents = payload.events.length > 0;

      if (!divergedVersion && !divergedHash && !hasEvents) {
        return { events: [] };
      }

      return {
        version: row.version,
        state: { contributions: payload.contributions, hash: payload.hash },
        events: payload.events,
      };
    },
  };
}

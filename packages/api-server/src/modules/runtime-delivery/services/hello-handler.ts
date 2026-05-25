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

/**
 * `runtime.v1.hello` handler (ADR-052). Agent boot/wake catch-up.
 *
 *   1. Upsert the agent's runtime metadata (protocol version, advertised
 *      capabilities, agent-runtime version).
 *   2. Run the same state-builder the worker uses.
 *   3. Compare to the agent's reported state. If anything diverged
 *      (version != lastApplied, hash != lastAppliedHash, or pending
 *      events), return the envelope. Otherwise empty.
 *
 * Read-only with respect to the outbox cursor — the worker's next
 * dispatch (which fires because last_applied_version is still behind
 * version) is what stamps dispatched_at. In practice, hello immediately
 * precedes an applyState that empties the events from the next snapshot.
 */
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
        // No state ever computed for this agent. Nothing to send.
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

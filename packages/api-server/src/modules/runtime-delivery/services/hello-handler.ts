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
import type { HarnessConfigSnapshotWriter } from "./snapshot-writer.js";

/** Presence ping + worker enqueue when the outbox is ahead of the agent. */
export function createHelloHandler(deps: {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  snapshotWriter: HarnessConfigSnapshotWriter;
  queue: StateQueue;
  log: (msg: string) => void;
}): RuntimeDeliveryService {
  return {
    async hello(agentId: string, input: HelloInput): Promise<HelloResult> {
      await deps.agentsRuntimeRepo.upsertHello({
        agentId,
        protocolVersion: input.protocolVersion,
        capabilities: input.capabilities,
        agentRuntimeVersion: input.agentRuntimeVersion,
      });

      // The pod read its own file, so this confirms what an apply only declared.
      // `hello` deliberately carries no model list — it would cost a provider
      // round-trip on the path that delivers capabilities — and an absent one
      // leaves whatever an earlier apply established intact.
      if (input.harnessConfigCurrent) {
        try {
          await deps.snapshotWriter.merge(agentId, input.harnessConfigCurrent, {
            confirmed: true,
          });
        } catch (err) {
          // Display state — never the reason a boot registration fails.
          deps.log(
            `[runtime-hello] ${agentId}: harness-config snapshot write failed: ${(err as Error).message}`,
          );
        }
      }

      const row = await deps.outboxRepo.getRow(agentId);
      if (row && row.version > (input.lastAppliedVersion ?? 0)) {
        // Ready is about to flip true; retryUntilReady so a sub-second miss fast-retries, not waits for the sweep.
        await deps.queue.enqueue(agentId, { retryUntilReady: true });
      }
      return { events: [] };
    },
  };
}

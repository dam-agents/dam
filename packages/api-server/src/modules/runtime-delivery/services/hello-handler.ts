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
import { emit, EventType } from "../../../events.js";

export function createHelloHandler(deps: {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  snapshotWriter: HarnessConfigSnapshotWriter;
  queue: StateQueue;
  resolveOwner: (agentId: string) => Promise<string | null>;
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

      const ownerSub = await deps.resolveOwner(agentId);
      if (ownerSub) {
        emit({ type: EventType.RuntimeHelloReceived, agentId, ownerSub });
      }

      if (input.harnessConfigCurrent) {
        try {
          await deps.snapshotWriter.merge(agentId, input.harnessConfigCurrent, {
            confirmed: true,
          });
        } catch (err) {
          deps.log(
            `[runtime-hello] ${agentId}: harness-config snapshot write failed: ${(err as Error).message}`,
          );
        }
      }

      const row = await deps.outboxRepo.getRow(agentId);
      if (row && row.version > (input.lastAppliedVersion ?? 0)) {
        await deps.queue.enqueue(agentId, { retryUntilReady: true });
      }
      return { events: [] };
    },
  };
}

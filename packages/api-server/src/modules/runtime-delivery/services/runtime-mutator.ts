import type { Db } from "db";
import type {
  OutboxRepo,
  PendingEventRow,
} from "../infrastructure/outbox-repo.js";
import type { StateQueue } from "../infrastructure/state-queue.js";

export interface RuntimeMutator {
  commitInTx(
    tx: Db,
    agentId: string,
    events?: Omit<PendingEventRow, "agentId" | "version">[],
  ): Promise<number>;

  enqueueAfterCommit(agentId: string): Promise<void>;
}

export function createRuntimeMutator(deps: {
  outboxRepo: OutboxRepo;
  queue: StateQueue;
}): RuntimeMutator {
  return {
    async commitInTx(tx, agentId, events): Promise<number> {
      const version = await deps.outboxRepo.bumpVersion(agentId, tx);
      if (events && events.length > 0) {
        for (const e of events) {
          await deps.outboxRepo.insertEvent({
            id: e.id,
            agentId,
            kind: e.kind,
            payload: e.payload,
            version,
            expiresAt: e.expiresAt,
          });
        }
      }
      return version;
    },
    async enqueueAfterCommit(agentId): Promise<void> {
      await deps.queue.enqueue(agentId);
    },
  };
}

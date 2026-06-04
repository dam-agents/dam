import type { Db } from "db";
import type {
  OutboxRepo,
  PendingEventRow,
} from "../infrastructure/outbox-repo.js";
import type { StateQueue } from "../infrastructure/state-queue.js";

export interface RuntimeMutator {
  bump(
    agentId: string,
    events: Omit<PendingEventRow, "agentId" | "version">[],
  ): Promise<number>;

  enqueueAfterCommit(agentId: string): Promise<void>;
}

export function createRuntimeMutator(deps: {
  db: Db;
  outboxRepo: OutboxRepo;
  queue: StateQueue;
}): RuntimeMutator {
  return {
    async bump(agentId, events): Promise<number> {
      if (events.length === 0) {
        return deps.outboxRepo.bumpVersion(agentId);
      }
      return deps.db.transaction(async (tx) => {
        const version = await deps.outboxRepo.bumpVersion(agentId, tx, false);
        for (const e of events) {
          await deps.outboxRepo.insertEvent(
            {
              id: e.id,
              agentId,
              kind: e.kind,
              payload: e.payload,
              version,
              expiresAt: e.expiresAt,
            },
            tx,
          );
        }
        return version;
      });
    },

    async enqueueAfterCommit(agentId): Promise<void> {
      await deps.queue.enqueue(agentId);
    },
  };
}

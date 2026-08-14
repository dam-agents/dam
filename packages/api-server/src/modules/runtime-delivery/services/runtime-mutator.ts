import type { Db, DbTx } from "db";
import type {
  OutboxRepo,
  PendingEventRow,
} from "../infrastructure/outbox-repo.js";
import type { StateQueue } from "../infrastructure/state-queue.js";

export interface RuntimeMutator {
  bump(
    agentId: string,
    events: Omit<PendingEventRow, "agentId" | "version">[],
    tx?: Db | DbTx,
  ): Promise<number>;

  enqueueAfterCommit(agentId: string): Promise<void>;
}

export function createRuntimeMutator(deps: {
  db: Db;
  outboxRepo: OutboxRepo;
  queue: StateQueue;
}): RuntimeMutator {
  return {
    async bump(agentId, events, tx): Promise<number> {
      if (events.length === 0) {
        return deps.outboxRepo.bumpVersion(agentId, tx);
      }
      const write = async (scope: Db | DbTx): Promise<number> => {
        const version = await deps.outboxRepo.bumpVersion(
          agentId,
          scope,
          false,
        );
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
            scope,
          );
        }
        return version;
      };
      return tx ? write(tx) : deps.db.transaction(write);
    },

    async enqueueAfterCommit(agentId): Promise<void> {
      await deps.queue.enqueue(agentId);
    },
  };
}

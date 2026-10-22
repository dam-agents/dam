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

  /**
   * UNIT_BOUNDARY_DESCRIPTION: for a kind whose newest event replaces every
   * earlier one, an older event still waiting must never reach the runtime
   * after or beside the newer one, as a runtime that comes back from refusing
   * the kind would otherwise get the whole backlog in order.
   */
  supersede(
    agentId: string,
    kind: PendingEventRow["kind"],
    tx?: Db | DbTx,
  ): Promise<void>;

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

    async supersede(agentId, kind, tx): Promise<void> {
      await deps.outboxRepo.supersedePending(agentId, kind, tx);
    },

    async enqueueAfterCommit(agentId): Promise<void> {
      await deps.queue.enqueue(agentId);
    },
  };
}

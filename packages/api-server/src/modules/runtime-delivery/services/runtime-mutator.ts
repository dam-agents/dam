import type { Db } from "db";
import type {
  OutboxRepo,
  PendingEventRow,
} from "../infrastructure/outbox-repo.js";
import type { StateQueue } from "../infrastructure/state-queue.js";

export interface RuntimeMutator {
  /** Bump the outbox version after a state change. `events` is required
   *  to force every caller to make an explicit choice: pass `[]` for
   *  the common "I changed state, nothing to attach" case, or a list
   *  of events (today: scheduler triggers) that must ride the same
   *  version atomically. Returns the new version. Pair with
   *  `enqueueAfterCommit` so the worker picks the change up. */
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
      // No events → single statement, no transaction ceremony.
      if (events.length === 0) {
        return deps.outboxRepo.bumpVersion(agentId);
      }
      // Events present → bump + inserts must land atomically so the
      // agent sees them on the same applyState payload as the version
      // they're keyed to.
      return deps.db.transaction(async (tx) => {
        const version = await deps.outboxRepo.bumpVersion(agentId, tx);
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

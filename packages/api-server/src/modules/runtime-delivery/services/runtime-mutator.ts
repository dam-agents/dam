import type { Db } from "db";
import type {
  OutboxRepo,
  PendingEventRow,
} from "../infrastructure/outbox-repo.js";
import type { StateQueue } from "../infrastructure/state-queue.js";

/**
 * The canonical "I changed state, deliver it" helper (ADR-053). Every
 * agent-bound mutation goes through here so the trio (bump version, upsert
 * outbox, enqueue) stays one shape.
 *
 * Caller pattern:
 *   await db.transaction(async (tx) => {
 *     await someDomainWrite(tx, ...);
 *     await runtimeMutator.commitInTx(tx, agentId, optionalEvents);
 *   });
 *   await runtimeMutator.enqueueAfterCommit(agentId);
 *
 * The split lets the caller compose the domain mutation with the version
 * bump in one Postgres transaction, then enqueue after commit so a Redis
 * outage can't roll back the domain write.
 */
export interface RuntimeMutator {
  /**
   * Bump agent.version + upsert outbox row, optionally insert event rows.
   * Returns the new version. The caller is responsible for transaction
   * boundaries and for calling enqueueAfterCommit on success.
   */
  commitInTx(
    tx: Db,
    agentId: string,
    events?: Omit<PendingEventRow, "agentId" | "version">[],
  ): Promise<number>;

  /** Push a BullMQ job. Idempotent (jobId is per-agent stable). */
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

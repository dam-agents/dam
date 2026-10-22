import { sql, type Db, type DbTx } from "db";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { sessionDefaultsEvent } from "../domain/session-defaults-event.js";
import type { SessionPairRepo } from "../infrastructure/session-pair-repo.js";

export type PublishSessionDefaults = (agentId: string) => Promise<void>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: each event replaces the runtime's defaults, so
 * events must reach it in the order the defaults were saved. The read and the
 * queueing share one transaction holding the agent's row, so two publishes
 * that overlap queue their snapshots in the order they read them. An older
 * snapshot still waiting is superseded, so a runtime that comes back from
 * refusing the kind gets only the newest one. The event's timestamp is above
 * every one the agent already holds, since the runtime skips an event no newer
 * than the last it ran and two publishes can share a millisecond.
 */
export function createSessionDefaultsPublisher(deps: {
  db: Db;
  pairRepo: Pick<SessionPairRepo, "readSaved">;
  runtimeMutator: RuntimeMutator;
  now?: () => number;
}): PublishSessionDefaults {
  const now = deps.now ?? (() => Date.now());
  return async (agentId) => {
    await deps.db.transaction(async (tx) => {
      const saved = await deps.pairRepo.readSaved(agentId, tx);
      const at = Math.max(now(), (await lastEventAt(tx, agentId)) + 1);
      await deps.runtimeMutator.supersede(agentId, "session-defaults", tx);
      await deps.runtimeMutator.bump(
        agentId,
        [sessionDefaultsEvent(agentId, saved, at)],
        tx,
      );
    });
    await deps.runtimeMutator.enqueueAfterCommit(agentId);
  };
}

async function lastEventAt(tx: DbTx, agentId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT coalesce(max(substring(id from '([0-9]+)$')::bigint), 0) AS at
    FROM runtime_events
    WHERE agent_id = ${agentId} AND kind = 'session-defaults'
  `)) as unknown as { at: string }[];
  return Number(rows[0]?.at ?? 0);
}

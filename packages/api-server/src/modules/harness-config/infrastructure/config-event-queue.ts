import { sql, type Db, type DbTx } from "db";
import type { HarnessConfigEventPayload } from "agent-runtime-api";
import type { OutboxRepo } from "../../runtime-delivery/index.js";
import {
  EVENT_TTL_MS,
  harnessConfigEvent,
} from "../domain/harness-config-event.js";

export interface HarnessConfigEventQueue {
  queue(
    agentId: string,
    change: HarnessConfigEventPayload,
    tx?: Db | DbTx,
  ): Promise<number>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: every producer of a harness-config event, from the
 * Config panel and from the one-off mode reset. The event id carries the
 * Agent's dedupe timestamp, and the runtime skips an event that is not newer
 * than the last one it ran, so the timestamp is allocated under the outbox row
 * lock and above every harness-config event the Agent already holds: one
 * allocation, so no producer can queue an event another one would skip.
 */
export function createHarnessConfigEventQueue(deps: {
  db: Db;
  outboxRepo: OutboxRepo;
  now?: () => number;
}): HarnessConfigEventQueue {
  const now = deps.now ?? (() => Date.now());

  return {
    async queue(agentId, change, tx) {
      const write = async (scope: Db | DbTx): Promise<number> => {
        const version = await deps.outboxRepo.bumpVersion(
          agentId,
          scope,
          false,
        );
        const rows = (await scope.execute(sql`
          SELECT coalesce(max(substring(id from '([0-9]+)$')::bigint), 0) AS at
          FROM runtime_events
          WHERE agent_id = ${agentId} AND kind = 'harness-config'
        `)) as unknown as { at: string }[];
        const at = Math.max(now(), Number(rows[0]?.at ?? 0) + 1);
        await deps.outboxRepo.insertEvent(
          {
            ...harnessConfigEvent(
              agentId,
              change,
              at,
              new Date(at + EVENT_TTL_MS),
            ),
            agentId,
            version,
          },
          scope,
        );
        return version;
      };
      return tx ? write(tx) : deps.db.transaction(write);
    },
  };
}

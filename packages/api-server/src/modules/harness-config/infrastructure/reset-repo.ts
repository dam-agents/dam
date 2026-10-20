import { sql, type Db, type DbTx } from "db";

/** UNIT_BOUNDARY_DESCRIPTION: the row that says the one-time pass froze its cohort: no Agent, every Agent. */
const WHOLE_RUN = "*";

export interface HarnessConfigResetRepo {
  roster(tx?: Db | DbTx): Promise<boolean>;
  pending(input: { after: string; limit: number }): Promise<string[]>;
  claim(agentId: string, tx: Db | DbTx): Promise<boolean>;
  frozen(tx?: Db | DbTx): Promise<boolean>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the storage of one harness-config reset — the
 * cohort it froze and the Agents of it it has settled. Freezing writes the
 * pass's own row and the eligible Agents in one transaction, so membership is
 * fixed before any Agent is processed: an Agent created, granted the preset or
 * set to the old mode after that moment is never eligible, and an Agent whose
 * correction failed stays pending and is retried on a later start.
 */
export function createHarnessConfigResetRepo(deps: {
  db: Db;
  reset: string;
  template: string;
  harness: string;
  from: string;
}): HarnessConfigResetRepo {
  return {
    async roster(tx = deps.db) {
      return tx.transaction(async (inner) => {
        const marker = (await inner.execute(sql`
          INSERT INTO harness_config_resets (reset, agent_id, settled_at)
          VALUES (${deps.reset}, ${WHOLE_RUN}, now())
          ON CONFLICT DO NOTHING
          RETURNING agent_id
        `)) as unknown as unknown[];
        if (marker.length === 0) return false;
        await inner.execute(sql`
          INSERT INTO harness_config_resets (reset, agent_id)
          SELECT ${deps.reset}, g.agent_id
          FROM connection_grants g
          JOIN connections c ON c.id = g.connection_id
          JOIN agents a ON a.id = g.agent_id
          WHERE c.template_id = ${deps.template}
            AND a.deleted_at IS NULL
            AND coalesce(
              a.harness_config_snapshot -> 'harnesses' -> ${deps.harness} ->> 'mode',
              a.harness_config_snapshot ->> 'mode'
            ) = ${deps.from}
          ON CONFLICT DO NOTHING
        `);
        return true;
      });
    },

    async pending({ after, limit }) {
      const rows = (await deps.db.execute(sql`
        SELECT agent_id FROM harness_config_resets
        WHERE reset = ${deps.reset}
          AND agent_id <> ${WHOLE_RUN}
          AND settled_at IS NULL
          AND agent_id > ${after}
        ORDER BY agent_id
        LIMIT ${limit}
      `)) as unknown as { agent_id: string }[];
      return rows.map((row) => row.agent_id);
    },

    async claim(agentId, tx) {
      const rows = (await tx.execute(sql`
        UPDATE harness_config_resets SET settled_at = now()
        WHERE reset = ${deps.reset} AND agent_id = ${agentId}
          AND settled_at IS NULL
        RETURNING agent_id
      `)) as unknown as unknown[];
      return rows.length > 0;
    },

    async frozen(tx = deps.db) {
      const rows = (await tx.execute(sql`
        SELECT 1 FROM harness_config_resets
        WHERE reset = ${deps.reset} AND agent_id = ${WHOLE_RUN}
      `)) as unknown as unknown[];
      return rows.length > 0;
    },
  };
}

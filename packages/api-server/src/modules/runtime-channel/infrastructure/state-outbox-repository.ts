import { eq, sql, type Db } from "db";
import { runtimeStateOutbox } from "db";

export interface StateOutboxRow {
  agentId: string;
  version: string;
  enqueuedAt: Date;
  lastAppliedHash: string | null;
  lastAppliedAt: Date | null;
}

export interface StateOutboxRepository {
  /** Upsert the agent's row, bumping the version. Called inside the
   *  mutation transaction that produced the state change. The version
   *  is a string so future migrations to opaque tokens (Lamport, ULID)
   *  don't break the schema; here it's the timestamp in ms, padded to
   *  preserve lexicographic ordering. */
  bumpVersion(agentId: string, version: string): Promise<void>;
  get(agentId: string): Promise<StateOutboxRow | null>;
  /** Record what the agent confirmed it applied. The version comparison
   *  uses lexicographic order, matching `bumpVersion`'s padded format. */
  markApplied(input: {
    agentId: string;
    appliedHash: string;
    appliedAt: Date;
  }): Promise<void>;
  /** Rows whose enqueue is older than the supplied threshold — used by
   *  the cron sweep to re-enqueue jobs Redis may have dropped. */
  listStale(opts: {
    olderThan: Date;
    limit: number;
  }): Promise<StateOutboxRow[]>;
  deleteForAgent(agentId: string): Promise<void>;
}

export function createStateOutboxRepository(db: Db): StateOutboxRepository {
  return {
    async bumpVersion(agentId, version) {
      await db
        .insert(runtimeStateOutbox)
        .values({ agentId, version })
        .onConflictDoUpdate({
          target: runtimeStateOutbox.agentId,
          set: { version, enqueuedAt: sql`now()` },
        });
    },

    async get(agentId) {
      const rows = await db
        .select()
        .from(runtimeStateOutbox)
        .where(eq(runtimeStateOutbox.agentId, agentId))
        .limit(1);
      const r = rows[0];
      return r
        ? {
            agentId: r.agentId,
            version: r.version,
            enqueuedAt: r.enqueuedAt,
            lastAppliedHash: r.lastAppliedHash,
            lastAppliedAt: r.lastAppliedAt,
          }
        : null;
    },

    async markApplied({ agentId, appliedHash, appliedAt }) {
      await db
        .update(runtimeStateOutbox)
        .set({ lastAppliedHash: appliedHash, lastAppliedAt: appliedAt })
        .where(eq(runtimeStateOutbox.agentId, agentId));
    },

    async listStale({ olderThan, limit }) {
      const rows = await db
        .select()
        .from(runtimeStateOutbox)
        .where(sql`${runtimeStateOutbox.enqueuedAt} < ${olderThan}`)
        .limit(limit);
      return rows.map((r) => ({
        agentId: r.agentId,
        version: r.version,
        enqueuedAt: r.enqueuedAt,
        lastAppliedHash: r.lastAppliedHash,
        lastAppliedAt: r.lastAppliedAt,
      }));
    },

    async deleteForAgent(agentId) {
      await db
        .delete(runtimeStateOutbox)
        .where(eq(runtimeStateOutbox.agentId, agentId));
    },
  };
}

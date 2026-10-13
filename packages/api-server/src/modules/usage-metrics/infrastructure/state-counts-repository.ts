import {
  agents,
  eq,
  isNull,
  kbShares,
  skillSets,
  slackInstalls,
  sql,
  type Db,
} from "db";
import type {
  LiveAgentRow,
  StateCountsReader,
} from "../domain/state-snapshot.js";

export function createStateCountsRepository(db: Db): StateCountsReader {
  return {
    async liveAgents(): Promise<LiveAgentRow[]> {
      return db
        .select({
          id: agents.id,
          starterKit: agents.starterKit,
          spawnedByAgentId: agents.spawnedByAgentId,
        })
        .from(agents)
        .where(isNull(agents.deletedAt));
    },

    async slackWorkspacesByState() {
      return db
        .select({
          state: slackInstalls.credentialState,
          count: sql<number>`count(*)::int`,
        })
        .from(slackInstalls)
        .groupBy(slackInstalls.credentialState);
    },

    async activeKbShares() {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(kbShares)
        .where(eq(kbShares.status, "active"));
      return row?.count ?? 0;
    },

    async skillSets() {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(skillSets);
      return row?.count ?? 0;
    },
  };
}

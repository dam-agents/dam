import { and, eq, inArray, spendAgentNames, type Db } from "db";

export interface LastKnownNames {
  keep(entry: {
    agentId: string;
    ownerSub: string;
    name: string;
    removedAt: Date;
  }): Promise<void>;
  namesOf(
    ownerSub: string,
    agentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

export function createLastKnownNames(db: Db): LastKnownNames {
  return {
    async keep(entry) {
      await db
        .insert(spendAgentNames)
        .values(entry)
        .onConflictDoUpdate({
          target: spendAgentNames.agentId,
          set: {
            ownerSub: entry.ownerSub,
            name: entry.name,
            removedAt: entry.removedAt,
          },
        });
    },

    async namesOf(ownerSub, agentIds) {
      if (agentIds.length === 0) return new Map();
      const rows = await db
        .select({
          agentId: spendAgentNames.agentId,
          name: spendAgentNames.name,
        })
        .from(spendAgentNames)
        .where(
          and(
            eq(spendAgentNames.ownerSub, ownerSub),
            inArray(spendAgentNames.agentId, [...agentIds]),
          ),
        );
      return new Map(rows.map((row) => [row.agentId, row.name]));
    },
  };
}

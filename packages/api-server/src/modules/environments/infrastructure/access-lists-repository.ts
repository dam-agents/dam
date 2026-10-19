import { eq, type Db, environmentAccessLists as table } from "db";

export interface AccessListsRepository {
  get(owningAgentId: string): Promise<string[]>;
  set(owningAgentId: string, owner: string, emails: string[]): Promise<void>;
  delete(owningAgentId: string): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The owner's list of people per agent, which every
 * Environment of that agent inherits; an agent with no row has an empty list,
 * so only its owner may open its Environments.
 */
export function createAccessListsRepository(db: Db): AccessListsRepository {
  return {
    async get(owningAgentId) {
      const [row] = await db
        .select()
        .from(table)
        .where(eq(table.owningAgentId, owningAgentId));
      return row?.emails ?? [];
    },

    async set(owningAgentId, owner, emails) {
      await db
        .insert(table)
        .values({ owningAgentId, owner, emails })
        .onConflictDoUpdate({
          target: table.owningAgentId,
          set: { emails, owner, updatedAt: new Date() },
        });
    },

    async delete(owningAgentId) {
      await db.delete(table).where(eq(table.owningAgentId, owningAgentId));
    },
  };
}

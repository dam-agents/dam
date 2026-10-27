import {
  and,
  asc,
  eq,
  inArray,
  notInArray,
  type Db,
  agentEnvironmentMembers as agentTable,
  environmentMembers as environmentTable,
} from "db";

export interface MembersRepository {
  ofAgent(owningAgentId: string): Promise<string[]>;
  setOfAgent(owningAgentId: string, emails: string[]): Promise<void>;
  deleteOfAgent(owningAgentId: string): Promise<void>;
  ofEnvironment(environmentId: string): Promise<string[]>;
  ofEnvironments(environmentIds: string[]): Promise<Map<string, string[]>>;
  setOfEnvironment(environmentId: string, emails: string[]): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The two lists of people who may open an
 * Environment, a row per email each. An Agent's Environment Members open every
 * Environment of that Agent; an Environment's own members open that one only.
 * Setting a list replaces it whole, in one transaction, and keeps the date each
 * person who stays on it was added. An Environment's rows go with it.
 */
export function createMembersRepository(db: Db): MembersRepository {
  async function ofEnvironments(environmentIds: string[]) {
    const map = new Map<string, string[]>();
    for (const id of environmentIds) map.set(id, []);
    if (environmentIds.length === 0) return map;
    const rows = await db
      .select({
        environmentId: environmentTable.environmentId,
        email: environmentTable.email,
      })
      .from(environmentTable)
      .where(inArray(environmentTable.environmentId, environmentIds))
      .orderBy(asc(environmentTable.addedAt), asc(environmentTable.email));
    for (const r of rows) map.get(r.environmentId)?.push(r.email);
    return map;
  }

  return {
    async ofAgent(owningAgentId) {
      const rows = await db
        .select({ email: agentTable.email })
        .from(agentTable)
        .where(eq(agentTable.owningAgentId, owningAgentId))
        .orderBy(asc(agentTable.addedAt), asc(agentTable.email));
      return rows.map((r) => r.email);
    },

    async setOfAgent(owningAgentId, emails) {
      await db.transaction(async (tx) => {
        await tx
          .delete(agentTable)
          .where(
            and(
              eq(agentTable.owningAgentId, owningAgentId),
              notInArray(agentTable.email, emails),
            ),
          );
        if (emails.length > 0)
          await tx
            .insert(agentTable)
            .values(emails.map((email) => ({ owningAgentId, email })))
            .onConflictDoNothing();
      });
    },

    async deleteOfAgent(owningAgentId) {
      await db
        .delete(agentTable)
        .where(eq(agentTable.owningAgentId, owningAgentId));
    },

    async ofEnvironment(environmentId) {
      return (await ofEnvironments([environmentId])).get(environmentId) ?? [];
    },

    ofEnvironments,

    async setOfEnvironment(environmentId, emails) {
      await db.transaction(async (tx) => {
        await tx
          .delete(environmentTable)
          .where(
            and(
              eq(environmentTable.environmentId, environmentId),
              notInArray(environmentTable.email, emails),
            ),
          );
        if (emails.length > 0)
          await tx
            .insert(environmentTable)
            .values(emails.map((email) => ({ environmentId, email })))
            .onConflictDoNothing();
      });
    },
  };
}

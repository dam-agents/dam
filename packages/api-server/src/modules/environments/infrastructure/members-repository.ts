import {
  and,
  asc,
  eq,
  inArray,
  notInArray,
  or,
  sql,
  type Db,
  agentEnvironmentAgentMembers as agentAgentTable,
  agentEnvironmentMembers as agentTable,
  environmentAgentMembers as environmentAgentTable,
  environmentAgentVisits as visitsTable,
  environmentMembers as environmentTable,
  environments,
} from "db";

export interface MembersRepository {
  ofAgent(owningAgentId: string): Promise<string[]>;
  setOfAgent(owningAgentId: string, emails: string[]): Promise<void>;
  deleteOfAgent(owningAgentId: string): Promise<void>;
  ofEnvironment(environmentId: string): Promise<string[]>;
  ofEnvironments(environmentIds: string[]): Promise<Map<string, string[]>>;
  setOfEnvironment(environmentId: string, emails: string[]): Promise<void>;
  agentsOfAgent(owningAgentId: string): Promise<string[]>;
  setAgentsOfAgent(owningAgentId: string, agentIds: string[]): Promise<void>;
  agentsOfEnvironment(environmentId: string): Promise<string[]>;
  agentsOfEnvironments(
    environmentIds: string[],
  ): Promise<Map<string, string[]>>;
  setAgentsOfEnvironment(
    environmentId: string,
    agentIds: string[],
  ): Promise<void>;
  // UNIT_BOUNDARY_DESCRIPTION: the Environments an Agent is listed on: those whose own list names it, and every Environment of an Agent whose list names it.
  environmentsSharedWith(agentId: string): Promise<string[]>;
  recordVisit(environmentId: string, agentId: string, at: Date): Promise<void>;
  // UNIT_BOUNDARY_DESCRIPTION: when each Agent last opened one of the given Environments, the latest across them.
  lastOpened(
    environmentIds: string[],
    agentIds: string[],
  ): Promise<Map<string, Date>>;
  // UNIT_BOUNDARY_DESCRIPTION: removes an Agent from every list it is on and its visits, when it is deleted, so a later Agent can never inherit them.
  forgetMemberAgent(agentId: string): Promise<void>;
  listMemberAgentIds(): Promise<string[]>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The two lists of who may open an Environment,
 * people by email and Agents by id, a row each, the two kinds in tables of
 * their own so an email never matches an Agent. An Agent's Environment
 * Members open every Environment of that Agent; an Environment's own members
 * open that one only.
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

  async function agentsOfEnvironments(environmentIds: string[]) {
    const map = new Map<string, string[]>();
    for (const id of environmentIds) map.set(id, []);
    if (environmentIds.length === 0) return map;
    const rows = await db
      .select({
        environmentId: environmentAgentTable.environmentId,
        agentId: environmentAgentTable.memberAgentId,
      })
      .from(environmentAgentTable)
      .where(inArray(environmentAgentTable.environmentId, environmentIds))
      .orderBy(
        asc(environmentAgentTable.addedAt),
        asc(environmentAgentTable.memberAgentId),
      );
    for (const r of rows) map.get(r.environmentId)?.push(r.agentId);
    return map;
  }

  return {
    agentsOfEnvironments,

    async agentsOfAgent(owningAgentId) {
      const rows = await db
        .select({ agentId: agentAgentTable.memberAgentId })
        .from(agentAgentTable)
        .where(eq(agentAgentTable.owningAgentId, owningAgentId))
        .orderBy(
          asc(agentAgentTable.addedAt),
          asc(agentAgentTable.memberAgentId),
        );
      return rows.map((r) => r.agentId);
    },

    async setAgentsOfAgent(owningAgentId, agentIds) {
      await db.transaction(async (tx) => {
        await tx
          .delete(agentAgentTable)
          .where(
            and(
              eq(agentAgentTable.owningAgentId, owningAgentId),
              notInArray(agentAgentTable.memberAgentId, agentIds),
            ),
          );
        if (agentIds.length > 0)
          await tx
            .insert(agentAgentTable)
            .values(
              agentIds.map((memberAgentId) => ({
                owningAgentId,
                memberAgentId,
              })),
            )
            .onConflictDoNothing();
      });
    },

    async agentsOfEnvironment(environmentId) {
      return (
        (await agentsOfEnvironments([environmentId])).get(environmentId) ?? []
      );
    },

    async setAgentsOfEnvironment(environmentId, agentIds) {
      await db.transaction(async (tx) => {
        await tx
          .delete(environmentAgentTable)
          .where(
            and(
              eq(environmentAgentTable.environmentId, environmentId),
              notInArray(environmentAgentTable.memberAgentId, agentIds),
            ),
          );
        if (agentIds.length > 0)
          await tx
            .insert(environmentAgentTable)
            .values(
              agentIds.map((memberAgentId) => ({
                environmentId,
                memberAgentId,
              })),
            )
            .onConflictDoNothing();
      });
    },

    async environmentsSharedWith(agentId) {
      const rows = await db
        .select({ id: environments.agentId })
        .from(environments)
        .where(
          or(
            inArray(
              environments.agentId,
              db
                .select({ id: environmentAgentTable.environmentId })
                .from(environmentAgentTable)
                .where(eq(environmentAgentTable.memberAgentId, agentId)),
            ),
            inArray(
              environments.owningAgentId,
              db
                .select({ id: agentAgentTable.owningAgentId })
                .from(agentAgentTable)
                .where(eq(agentAgentTable.memberAgentId, agentId)),
            ),
          ),
        );
      return rows.map((r) => r.id);
    },

    async recordVisit(environmentId, agentId, at) {
      await db
        .insert(visitsTable)
        .values({ environmentId, agentId, lastOpenedAt: at })
        .onConflictDoUpdate({
          target: [visitsTable.environmentId, visitsTable.agentId],
          set: { lastOpenedAt: at },
        });
    },

    async lastOpened(environmentIds, agentIds) {
      const out = new Map<string, Date>();
      if (environmentIds.length === 0 || agentIds.length === 0) return out;
      const rows = await db
        .select({
          agentId: visitsTable.agentId,
          at: sql<Date | string | null>`max(${visitsTable.lastOpenedAt})`,
        })
        .from(visitsTable)
        .where(
          and(
            inArray(visitsTable.environmentId, environmentIds),
            inArray(visitsTable.agentId, agentIds),
          ),
        )
        .groupBy(visitsTable.agentId);
      for (const r of rows) if (r.at) out.set(r.agentId, new Date(r.at));
      return out;
    },

    async forgetMemberAgent(agentId) {
      await db.transaction(async (tx) => {
        await tx
          .delete(agentAgentTable)
          .where(eq(agentAgentTable.memberAgentId, agentId));
        await tx
          .delete(environmentAgentTable)
          .where(eq(environmentAgentTable.memberAgentId, agentId));
        await tx.delete(visitsTable).where(eq(visitsTable.agentId, agentId));
      });
    },

    async listMemberAgentIds() {
      const rows = await db.execute<{ id: string }>(sql`
        SELECT member_agent_id AS id FROM ${agentAgentTable}
        UNION SELECT member_agent_id FROM ${environmentAgentTable}
        UNION SELECT agent_id FROM ${visitsTable}
      `);
      return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    },

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
      await db
        .delete(agentAgentTable)
        .where(eq(agentAgentTable.owningAgentId, owningAgentId));
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

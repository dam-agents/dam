import {
  and,
  eq,
  inArray,
  isNull,
  agents as agentsTable,
  connectionGrants,
  connections as connectionsTable,
  type Db,
} from "db";
import {
  PROVIDER_TEMPLATE_IDS,
  sessionPairSchema,
  type DefaultModelNotice,
} from "api-server-api";

import {
  defaultModelNoteSchema,
  defaultModelNoticeOf,
} from "../domain/default-model-notice.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the default-model notices of the given Agents
 * (an owner's, from the Agent store: the row's owner is pseudonymized), read
 * from the database alone so a sleeping Agent is never woken to draw Home;
 * sub-agents a session spawned are left out.
 */
export function createDefaultModelNoticeReader(
  db: Db,
): (agentIds: readonly string[]) => Promise<DefaultModelNotice[]> {
  return async (agentIds) => {
    if (agentIds.length === 0) return [];
    const rows = await db
      .select({
        id: agentsTable.id,
        pair: agentsTable.sessionPair,
        note: agentsTable.defaultModelNote,
      })
      .from(agentsTable)
      .where(
        and(
          inArray(agentsTable.id, [...agentIds]),
          isNull(agentsTable.deletedAt),
          isNull(agentsTable.spawnedByAgentId),
        ),
      );
    const withPair = rows.filter((r) => r.pair !== null);
    if (withPair.length === 0) return [];
    const grants = await db
      .select({
        agentId: connectionGrants.agentId,
        connectionId: connectionGrants.connectionId,
      })
      .from(connectionGrants)
      .innerJoin(
        connectionsTable,
        eq(connectionGrants.connectionId, connectionsTable.id),
      )
      .where(
        and(
          inArray(
            connectionGrants.agentId,
            withPair.map((r) => r.id),
          ),
          inArray(connectionsTable.templateId, [...PROVIDER_TEMPLATE_IDS]),
        ),
      );
    const granted = new Map<string, Set<string>>();
    for (const g of grants)
      granted.set(
        g.agentId,
        (granted.get(g.agentId) ?? new Set()).add(g.connectionId),
      );
    return withPair.flatMap((r) => {
      const pair = sessionPairSchema.safeParse(r.pair);
      const note = defaultModelNoteSchema.safeParse(r.note);
      const notice = defaultModelNoticeOf({
        agentId: r.id,
        pair: pair.success ? pair.data : null,
        note: note.success ? note.data : null,
        grantedProviders: granted.get(r.id) ?? new Set(),
      });
      return notice ? [notice] : [];
    });
  };
}

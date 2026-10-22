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
import { PROVIDER_TEMPLATE_IDS } from "api-server-api";

import { readUnattendedWork, type UnattendedWork } from "./unattended-work.js";

export interface UnattendedAgent extends UnattendedWork {
  readonly agentId: string;
  readonly soleProvider: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Agents granted a Connection of the given
 * template that run work while nobody watches, read from the database alone,
 * so a sleeping Agent is never woken. Deleted Agents and sub-agents a session
 * spawned are left out. `soleProvider` says that the Agent holds no model
 * provider of another template, so a run that names no provider still runs
 * on this one.
 */
export function createUnattendedAgentsReader(
  db: Db,
): (templateId: string) => Promise<UnattendedAgent[]> {
  return async (templateId) => {
    const granted = await db
      .selectDistinct({ agentId: connectionGrants.agentId })
      .from(connectionGrants)
      .innerJoin(
        connectionsTable,
        eq(connectionGrants.connectionId, connectionsTable.id),
      )
      .innerJoin(agentsTable, eq(agentsTable.id, connectionGrants.agentId))
      .where(
        and(
          eq(connectionsTable.templateId, templateId),
          isNull(agentsTable.deletedAt),
          isNull(agentsTable.spawnedByAgentId),
        ),
      );
    const work = await readUnattendedWork(
      db,
      granted.map((r) => r.agentId),
    );
    if (work.size === 0) return [];
    const providers = await db
      .selectDistinct({
        agentId: connectionGrants.agentId,
        templateId: connectionsTable.templateId,
      })
      .from(connectionGrants)
      .innerJoin(
        connectionsTable,
        eq(connectionGrants.connectionId, connectionsTable.id),
      )
      .where(
        and(
          inArray(connectionGrants.agentId, [...work.keys()]),
          inArray(connectionsTable.templateId, [...PROVIDER_TEMPLATE_IDS]),
        ),
      );
    const onOtherProviders = new Set(
      providers
        .filter((p) => p.templateId !== templateId)
        .map((p) => p.agentId),
    );
    return [...work].map(([agentId, kinds]) => ({
      agentId,
      ...kinds,
      soleProvider: !onOtherProviders.has(agentId),
    }));
  };
}

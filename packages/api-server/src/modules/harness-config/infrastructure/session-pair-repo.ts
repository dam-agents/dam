import {
  and,
  asc,
  eq,
  inArray,
  agents as agentsTable,
  connectionGrants,
  connections as connectionsTable,
  type Db,
} from "db";
import {
  PROVIDER_TEMPLATE_IDS,
  providerTypeForTemplateId,
  sessionPairSchema,
  type SessionPair,
} from "api-server-api";
import type { GrantedProvider } from "../domain/session-pair.js";

export interface SessionPairRepo {
  read(agentId: string): Promise<SessionPair | null>;
  write(agentId: string, pair: SessionPair): Promise<void>;
  grantedProviders(agentId: string): Promise<GrantedProvider[]>;
}

export function createSessionPairRepo(db: Db): SessionPairRepo {
  return {
    async read(agentId) {
      const rows = await db
        .select({ pair: agentsTable.sessionPair })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId));
      const parsed = sessionPairSchema.safeParse(rows[0]?.pair);
      return parsed.success ? parsed.data : null;
    },

    async write(agentId, pair) {
      await db
        .update(agentsTable)
        .set({ sessionPair: pair })
        .where(eq(agentsTable.id, agentId));
    },

    async grantedProviders(agentId) {
      const rows = await db
        .select({
          id: connectionsTable.id,
          templateId: connectionsTable.templateId,
        })
        .from(connectionGrants)
        .innerJoin(
          connectionsTable,
          eq(connectionGrants.connectionId, connectionsTable.id),
        )
        .where(
          and(
            eq(connectionGrants.agentId, agentId),
            inArray(connectionsTable.templateId, [...PROVIDER_TEMPLATE_IDS]),
          ),
        )
        .orderBy(asc(connectionsTable.name), asc(connectionsTable.id));
      return rows.flatMap((r) => {
        const type = providerTypeForTemplateId(r.templateId);
        return type ? [{ id: r.id, type }] : [];
      });
    },
  };
}

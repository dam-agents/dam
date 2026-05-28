import {
  and,
  asc,
  desc,
  eq,
  inArray,
  type Db,
  connectionGrants as connectionGrantsTable,
  connections as connectionsTable,
} from "db";
import {
  connectionAuthConfigSchema as authConfigSchema,
  contribution as contributionSchema,
  type Connection,
  type ConnectionAuthConfig,
  type Contribution,
} from "api-server-api";

export interface ConnectionsRepository {
  insert(input: {
    id: string;
    ownerId: string;
    templateId: string;
    name: string;
    inputs: Record<string, unknown>;
    auth: ConnectionAuthConfig;
    contributions: Contribution[];
  }): Promise<void>;

  listByOwner(ownerId: string): Promise<Connection[]>;

  get(id: string, ownerId: string): Promise<Connection | null>;

  updateAuth(id: string, auth: ConnectionAuthConfig): Promise<void>;

  delete(id: string, ownerId: string): Promise<void>;

  grant(connectionId: string, agentId: string): Promise<void>;
  revoke(connectionId: string, agentId: string): Promise<void>;
  listAgentGrants(
    agentId: string,
  ): Promise<{ connectionId: string; grantedAt: Date }[]>;
  listConnectionsForAgent(agentId: string): Promise<Connection[]>;
  /** Agents that currently have this connection granted. Used by
   *  deleteConnection to fan-out the removal to each affected agent
   *  before the grant rows cascade away. */
  listAgentsForConnection(connectionId: string): Promise<string[]>;
}

interface InternalConnectionRow {
  id: string;
  owner: string;
  templateId: string;
  name: string;
  inputs: unknown;
  auth: unknown;
  contributions: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function rowToConnection(row: InternalConnectionRow): Connection {
  const auth = authConfigSchema.parse(row.auth);
  const contributions = Array.isArray(row.contributions)
    ? row.contributions
        .map((c) => contributionSchema.safeParse(c))
        .filter((r): r is { success: true; data: Contribution } => r.success)
        .map((r) => r.data)
    : [];
  return {
    id: row.id,
    ownerId: row.owner,
    templateId: row.templateId,
    name: row.name,
    inputs: (row.inputs as Record<string, unknown>) ?? {},
    auth,
    contributions,
  };
}

export function createConnectionsRepository(db: Db): ConnectionsRepository {
  return {
    async insert(input): Promise<void> {
      await db.insert(connectionsTable).values({
        id: input.id,
        owner: input.ownerId,
        templateId: input.templateId,
        name: input.name,
        inputs: input.inputs,
        auth: input.auth,
        contributions: input.contributions,
      });
    },

    async listByOwner(ownerId): Promise<Connection[]> {
      const rows = (await db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.owner, ownerId))
        .orderBy(asc(connectionsTable.name))) as InternalConnectionRow[];
      return rows.map(rowToConnection);
    },

    async get(id, ownerId): Promise<Connection | null> {
      const rows = (await db
        .select()
        .from(connectionsTable)
        .where(
          and(eq(connectionsTable.id, id), eq(connectionsTable.owner, ownerId)),
        )) as InternalConnectionRow[];
      return rows[0] ? rowToConnection(rows[0]) : null;
    },

    async updateAuth(id, auth): Promise<void> {
      await db
        .update(connectionsTable)
        .set({ auth, updatedAt: new Date() })
        .where(eq(connectionsTable.id, id));
    },

    async delete(id, ownerId): Promise<void> {
      await db
        .delete(connectionGrantsTable)
        .where(eq(connectionGrantsTable.connectionId, id));
      await db
        .delete(connectionsTable)
        .where(
          and(eq(connectionsTable.id, id), eq(connectionsTable.owner, ownerId)),
        );
    },

    async grant(connectionId, agentId): Promise<void> {
      await db
        .insert(connectionGrantsTable)
        .values({ connectionId, agentId })
        .onConflictDoNothing();
    },

    async revoke(connectionId, agentId): Promise<void> {
      await db
        .delete(connectionGrantsTable)
        .where(
          and(
            eq(connectionGrantsTable.connectionId, connectionId),
            eq(connectionGrantsTable.agentId, agentId),
          ),
        );
    },

    async listAgentGrants(
      agentId,
    ): Promise<{ connectionId: string; grantedAt: Date }[]> {
      const rows = (await db
        .select()
        .from(connectionGrantsTable)
        .where(eq(connectionGrantsTable.agentId, agentId))
        .orderBy(desc(connectionGrantsTable.grantedAt))) as {
        connectionId: string;
        grantedAt: Date;
      }[];
      return rows;
    },

    async listConnectionsForAgent(agentId): Promise<Connection[]> {
      const grants = (await db
        .select({ connectionId: connectionGrantsTable.connectionId })
        .from(connectionGrantsTable)
        .where(eq(connectionGrantsTable.agentId, agentId))) as {
        connectionId: string;
      }[];
      if (grants.length === 0) return [];
      const rows = (await db
        .select()
        .from(connectionsTable)
        .where(
          inArray(
            connectionsTable.id,
            grants.map((g) => g.connectionId),
          ),
        )) as InternalConnectionRow[];
      return rows.map(rowToConnection);
    },

    async listAgentsForConnection(connectionId): Promise<string[]> {
      const rows = (await db
        .select({ agentId: connectionGrantsTable.agentId })
        .from(connectionGrantsTable)
        .where(eq(connectionGrantsTable.connectionId, connectionId))) as {
        agentId: string;
      }[];
      return rows.map((r) => r.agentId);
    },
  };
}

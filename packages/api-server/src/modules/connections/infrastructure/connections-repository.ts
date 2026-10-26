import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
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
    parentId?: string;
    isParent?: true;
  }): Promise<void>;

  listByOwner(ownerId: string): Promise<Connection[]>;
  listChildren(parentId: string): Promise<Connection[]>;
  listByOwnerOldestFirst(ownerId: string): Promise<Connection[]>;

  get(id: string, ownerId: string): Promise<Connection | null>;
  getById(id: string): Promise<Connection | null>;
  listDue(skewSec: number): Promise<Connection[]>;

  updateAuth(id: string, auth: ConnectionAuthConfig): Promise<void>;

  mergeInputs(id: string, patch: Record<string, unknown>): Promise<void>;

  updateContributions(id: string, contributions: Contribution[]): Promise<void>;

  updateName(id: string, name: string): Promise<void>;

  delete(id: string, ownerId: string): Promise<void>;

  grant(connectionId: string, agentId: string): Promise<void>;
  revoke(connectionId: string, agentId: string): Promise<void>;
  listAgentGrants(
    agentId: string,
  ): Promise<{ connectionId: string; grantedAt: Date; preferred: boolean }[]>;
  setPreferred(
    agentId: string,
    connectionId: string,
    clearConnectionIds: readonly string[],
  ): Promise<void>;
  listConnectionsForAgent(agentId: string): Promise<Connection[]>;
  listAgentsForConnection(connectionId: string): Promise<string[]>;
  revokeAllForAgent(agentId: string): Promise<void>;
  listDistinctGrantAgentIds(): Promise<string[]>;
  listOwnersOfTemplate(templateId: string): Promise<string[]>;
}

interface ConnectionRow {
  id: string;
  owner: string;
  templateId: string;
  name: string;
  inputs: unknown;
  auth: unknown;
  contributions: unknown;
  parentId?: string | null;
  isParent?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toConnection(row: ConnectionRow): Connection | null {
  const auth = authConfigSchema.safeParse(row.auth);
  if (!auth.success) return null;
  return {
    id: row.id,
    ownerId: row.owner,
    templateId: row.templateId,
    name: row.name,
    inputs: (row.inputs as Record<string, unknown>) ?? {},
    auth: auth.data,
    contributions: contributionsOf(row.contributions),
    ...(row.parentId ? { parentId: row.parentId } : {}),
    ...(row.isParent ? { isParent: true as const } : {}),
  };
}

function contributionsOf(raw: unknown): Contribution[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    const parsed = contributionSchema.safeParse(c);
    return parsed.success ? [parsed.data] : [];
  });
}

function connectionsOf(rows: readonly ConnectionRow[]): Connection[] {
  return rows.flatMap((row) => {
    const conn = toConnection(row);
    return conn ? [conn] : [];
  });
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
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(input.isParent ? { isParent: true } : {}),
      });
    },

    async listByOwner(ownerId): Promise<Connection[]> {
      const rows = (await db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.owner, ownerId))
        .orderBy(asc(connectionsTable.name))) as ConnectionRow[];
      return connectionsOf(rows);
    },

    async listChildren(parentId): Promise<Connection[]> {
      const rows = (await db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.parentId, parentId))
        .orderBy(
          asc(connectionsTable.createdAt),
          asc(connectionsTable.id),
        )) as ConnectionRow[];
      return connectionsOf(rows);
    },

    async listByOwnerOldestFirst(ownerId): Promise<Connection[]> {
      const rows = (await db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.owner, ownerId))
        .orderBy(
          asc(connectionsTable.createdAt),
          asc(connectionsTable.id),
        )) as ConnectionRow[];
      return connectionsOf(rows);
    },

    async get(id, ownerId): Promise<Connection | null> {
      const rows = (await db
        .select()
        .from(connectionsTable)
        .where(
          and(eq(connectionsTable.id, id), eq(connectionsTable.owner, ownerId)),
        )) as ConnectionRow[];
      return rows[0] ? toConnection(rows[0]) : null;
    },

    async getById(id): Promise<Connection | null> {
      const rows = (await db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.id, id))) as ConnectionRow[];
      return rows[0] ? toConnection(rows[0]) : null;
    },

    async listDue(skewSec): Promise<Connection[]> {
      const rows = (await db
        .select()
        .from(connectionsTable)
        .where(
          and(
            inArray(sql`${connectionsTable.auth} ->> 'kind'`, [
              "oauth",
              "client-credentials",
              "github-app",
            ]),
            sql`(${connectionsTable.auth} -> 'refreshFailedAt') IS NULL`,
            sql`
              (${connectionsTable.auth} -> 'expiresAt') IS NOT NULL
              AND ((${connectionsTable.auth} ->> 'expiresAt')::int - extract(epoch from now())::int) <= ${skewSec}
            `,
          ),
        )) as ConnectionRow[];
      return connectionsOf(rows);
    },

    async updateAuth(id, auth): Promise<void> {
      await db
        .update(connectionsTable)
        .set({ auth, updatedAt: new Date() })
        .where(eq(connectionsTable.id, id));
    },

    async mergeInputs(id, patch): Promise<void> {
      await db
        .update(connectionsTable)
        .set({
          inputs: sql`${connectionsTable.inputs} || ${JSON.stringify(patch)}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(connectionsTable.id, id));
    },

    async updateContributions(id, contributions): Promise<void> {
      await db
        .update(connectionsTable)
        .set({ contributions, updatedAt: new Date() })
        .where(eq(connectionsTable.id, id));
    },

    async updateName(id, name): Promise<void> {
      await db
        .update(connectionsTable)
        .set({ name, updatedAt: new Date() })
        .where(eq(connectionsTable.id, id));
    },

    async delete(id, ownerId): Promise<void> {
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
    ): Promise<
      { connectionId: string; grantedAt: Date; preferred: boolean }[]
    > {
      const rows = (await db
        .select()
        .from(connectionGrantsTable)
        .where(eq(connectionGrantsTable.agentId, agentId))
        .orderBy(desc(connectionGrantsTable.grantedAt))) as {
        connectionId: string;
        grantedAt: Date;
        preferred: boolean;
      }[];
      return rows;
    },

    async setPreferred(
      agentId,
      connectionId,
      clearConnectionIds,
    ): Promise<void> {
      if (clearConnectionIds.length > 0) {
        await db
          .update(connectionGrantsTable)
          .set({ preferred: false })
          .where(
            and(
              eq(connectionGrantsTable.agentId, agentId),
              inArray(connectionGrantsTable.connectionId, [
                ...clearConnectionIds,
              ]),
            ),
          );
      }
      await db
        .update(connectionGrantsTable)
        .set({ preferred: true })
        .where(
          and(
            eq(connectionGrantsTable.connectionId, connectionId),
            eq(connectionGrantsTable.agentId, agentId),
          ),
        );
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
        )) as ConnectionRow[];
      return connectionsOf(rows);
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

    async revokeAllForAgent(agentId): Promise<void> {
      await db
        .delete(connectionGrantsTable)
        .where(eq(connectionGrantsTable.agentId, agentId));
    },

    async listOwnersOfTemplate(templateId): Promise<string[]> {
      const rows = await db
        .selectDistinct({ owner: connectionsTable.owner })
        .from(connectionsTable)
        .where(eq(connectionsTable.templateId, templateId));
      return rows.map((r) => r.owner);
    },

    async listDistinctGrantAgentIds(): Promise<string[]> {
      const rows = await db
        .selectDistinct({ agentId: connectionGrantsTable.agentId })
        .from(connectionGrantsTable);
      return rows.map((r) => r.agentId);
    },
  };
}

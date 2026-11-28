import {
  and,
  apiKeyRevocations,
  asc,
  desc,
  eq,
  inArray,
  sql,
  type Db,
  connectionGrants as connectionGrantsTable,
  connections as connectionsTable,
} from "db";
import { DAM_KEY_INPUT } from "../domain/dam-connection.js";
import type { GrantedConnection } from "../domain/tool-access.js";
import {
  connectionAuthConfigSchema as authConfigSchema,
  connectionToolAccessRecordSchema as toolAccessRecordSchema,
  contribution as contributionSchema,
  grantToolAccessSchema,
  type Connection,
  type ConnectionAuthConfig,
  type ConnectionToolAccessRecord,
  type Contribution,
  type GrantToolAccess,
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
    toolAccess?: ConnectionToolAccessRecord;
  }): Promise<void>;

  listByOwner(ownerId: string): Promise<Connection[]>;
  listChildren(parentId: string): Promise<Connection[]>;
  listByOwnerOldestFirst(ownerId: string): Promise<Connection[]>;

  get(id: string, ownerId: string): Promise<Connection | null>;
  getById(id: string): Promise<Connection | null>;
  listDue(skewSec: number): Promise<Connection[]>;

  updateAuth(id: string, auth: ConnectionAuthConfig): Promise<void>;

  updateToolAccess(
    id: string,
    toolAccess: ConnectionToolAccessRecord,
  ): Promise<void>;

  mergeInputs(id: string, patch: Record<string, unknown>): Promise<void>;

  /* UNIT_BOUNDARY_DESCRIPTION: the Connection starts naming a key of its own, and the key it named before is queued for revocation in the same statement — so no moment exists in which the old key is neither named nor queued, and no failure can leave the new one unnamed and unqueued. */
  adoptDamKey(input: {
    id: string;
    ownerSub: string;
    keyId: string;
    previousKeyId: string | null;
  }): Promise<void>;

  updateContributions(id: string, contributions: Contribution[]): Promise<void>;

  updateName(id: string, name: string): Promise<void>;

  delete(id: string, ownerId: string): Promise<void>;

  /* UNIT_BOUNDARY_DESCRIPTION: grants a Connection to an Agent with the tool access the new grant starts with, or null to follow the Connection's tool mode. A grant that already exists keeps its own access. */
  grant(
    connectionId: string,
    agentId: string,
    toolAccess: GrantToolAccess | null,
  ): Promise<void>;
  revoke(connectionId: string, agentId: string): Promise<void>;
  listAgentGrants(agentId: string): Promise<
    {
      connectionId: string;
      grantedAt: Date;
      preferred: boolean;
      toolAccess: GrantToolAccess | null;
    }[]
  >;
  /* UNIT_BOUNDARY_DESCRIPTION: sets the tool access of one grant, and answers false when the Agent does not hold the Connection. */
  setGrantToolAccess(
    connectionId: string,
    agentId: string,
    toolAccess: GrantToolAccess,
  ): Promise<boolean>;
  /* UNIT_BOUNDARY_DESCRIPTION: clears the tool access of every grant of one Connection, so each of them follows the Connection's tool mode again. */
  clearGrantToolAccess(connectionId: string): Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: the Agent's granted Connections, each with the tool access its grant stores, in one read. */
  listGrantedConnections(agentId: string): Promise<GrantedConnection[]>;
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
  toolAccess?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function toConnection(row: ConnectionRow): Connection | null {
  const auth = authConfigSchema.safeParse(row.auth);
  if (!auth.success) return null;
  const toolAccess = toolAccessRecordSchema.safeParse(row.toolAccess);
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
    ...(toolAccess.success ? { toolAccess: toolAccess.data } : {}),
  };
}

function contributionsOf(raw: unknown): Contribution[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    const parsed = contributionSchema.safeParse(c);
    return parsed.success ? [parsed.data] : [];
  });
}

const BLOCK_ALL: GrantToolAccess = {
  read: "block",
  write: "block",
  overrides: {},
};

function grantToolAccessOf(raw: unknown): GrantToolAccess | null {
  if (raw === null || raw === undefined) return null;
  const parsed = grantToolAccessSchema.safeParse(raw);
  return parsed.success ? parsed.data : BLOCK_ALL;
}

function connectionsOf(rows: readonly ConnectionRow[]): Connection[] {
  return rows.flatMap((row) => {
    const conn = toConnection(row);
    return conn ? [conn] : [];
  });
}

export async function listConnectionsByTemplate(
  db: Db,
  templateId: string,
): Promise<Connection[]> {
  const rows = (await db
    .select()
    .from(connectionsTable)
    .where(eq(connectionsTable.templateId, templateId))) as ConnectionRow[];
  return connectionsOf(rows);
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
        ...(input.toolAccess ? { toolAccess: input.toolAccess } : {}),
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

    async updateToolAccess(id, toolAccess): Promise<void> {
      await db
        .update(connectionsTable)
        .set({ toolAccess, updatedAt: new Date() })
        .where(eq(connectionsTable.id, id));
    },

    async adoptDamKey({ id, ownerSub, keyId, previousKeyId }) {
      await db.transaction(async (tx) => {
        await tx
          .update(connectionsTable)
          .set({
            inputs: sql`${connectionsTable.inputs} || ${JSON.stringify({ [DAM_KEY_INPUT]: keyId })}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(connectionsTable.id, id));
        if (previousKeyId !== null) {
          await tx
            .insert(apiKeyRevocations)
            .values({ keyId: previousKeyId, ownerSub, connectionId: id })
            .onConflictDoNothing();
        }
      });
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

    async grant(connectionId, agentId, toolAccess): Promise<void> {
      await db
        .insert(connectionGrantsTable)
        .values({ connectionId, agentId, toolAccess })
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

    async listAgentGrants(agentId) {
      const rows = (await db
        .select()
        .from(connectionGrantsTable)
        .where(eq(connectionGrantsTable.agentId, agentId))
        .orderBy(desc(connectionGrantsTable.grantedAt))) as {
        connectionId: string;
        grantedAt: Date;
        preferred: boolean;
        toolAccess: unknown;
      }[];
      return rows.map((row) => ({
        connectionId: row.connectionId,
        grantedAt: row.grantedAt,
        preferred: row.preferred,
        toolAccess: grantToolAccessOf(row.toolAccess),
      }));
    },

    async setGrantToolAccess(
      connectionId,
      agentId,
      toolAccess,
    ): Promise<boolean> {
      const updated = await db
        .update(connectionGrantsTable)
        .set({ toolAccess })
        .where(
          and(
            eq(connectionGrantsTable.connectionId, connectionId),
            eq(connectionGrantsTable.agentId, agentId),
          ),
        )
        .returning({ agentId: connectionGrantsTable.agentId });
      return updated.length > 0;
    },

    async clearGrantToolAccess(connectionId): Promise<void> {
      await db
        .update(connectionGrantsTable)
        .set({ toolAccess: null })
        .where(eq(connectionGrantsTable.connectionId, connectionId));
    },

    async listGrantedConnections(agentId): Promise<GrantedConnection[]> {
      const rows = (await db
        .select({
          connection: connectionsTable,
          toolAccess: connectionGrantsTable.toolAccess,
        })
        .from(connectionGrantsTable)
        .innerJoin(
          connectionsTable,
          eq(connectionGrantsTable.connectionId, connectionsTable.id),
        )
        .where(eq(connectionGrantsTable.agentId, agentId))) as {
        connection: ConnectionRow;
        toolAccess: unknown;
      }[];
      return rows.flatMap((row) => {
        const connection = toConnection(row.connection);
        return connection
          ? [{ connection, toolAccess: grantToolAccessOf(row.toolAccess) }]
          : [];
      });
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

/* UNIT_BOUNDARY_DESCRIPTION: the derived credential each of an Agent's scoped grants uses, by its key. A grant with no scope uses its Connection's own credential and is not listed. */
export function listDerivedKeys(db: Db) {
  return async (
    agentId: string,
  ): Promise<{ connectionId: string; key: string }[]> => {
    const rows = await db
      .select({
        connectionId: connectionGrantsTable.connectionId,
        key: connectionGrantsTable.derivedKey,
      })
      .from(connectionGrantsTable)
      .where(eq(connectionGrantsTable.agentId, agentId));
    return rows.flatMap((row) =>
      row.key === null ? [] : [{ connectionId: row.connectionId, key: row.key }],
    );
  };
}

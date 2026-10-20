import { and, eq, lt, sql, type Db, environments as table } from "db";
import type { EnvironmentRecord } from "../domain/environment.js";

export interface EnvironmentsRepository {
  insert(record: EnvironmentRecord): Promise<void>;
  get(agentId: string): Promise<EnvironmentRecord | null>;
  getByHost(host: string): Promise<EnvironmentRecord | null>;
  listByOwningAgent(owningAgentId: string): Promise<EnvironmentRecord[]>;
  listExpired(now: Date): Promise<EnvironmentRecord[]>;
  listAgentIds(): Promise<string[]>;
  listOwningAgentIds(): Promise<string[]>;
  findByName(
    owningAgentId: string,
    name: string,
  ): Promise<EnvironmentRecord | null>;
  update(
    agentId: string,
    patch: Partial<
      Pick<EnvironmentRecord, "expiresAt" | "access" | "endpoints">
    >,
  ): Promise<void>;
  delete(agentId: string): Promise<void>;
  // UNIT_BOUNDARY_DESCRIPTION: runs fn holding a lock of this owning agent's across every api-server replica, so two creates never both pass the cap: a Postgres advisory lock for one transaction.
  forOwningAgent<T>(owningAgentId: string, fn: () => Promise<T>): Promise<T>;
}

type Row = typeof table.$inferSelect;

function fromRow(row: Row): EnvironmentRecord {
  return {
    agentId: row.agentId,
    owningAgentId: row.owningAgentId,
    owner: row.owner,
    name: row.name,
    host: row.host,
    endpoints: row.endpoints,
    access: row.access ?? null,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export function createEnvironmentsRepository(db: Db): EnvironmentsRepository {
  return {
    async insert(record) {
      await db.insert(table).values(record);
    },

    async get(agentId) {
      const [row] = await db
        .select()
        .from(table)
        .where(eq(table.agentId, agentId));
      return row ? fromRow(row) : null;
    },

    async getByHost(host) {
      const [row] = await db.select().from(table).where(eq(table.host, host));
      return row ? fromRow(row) : null;
    },

    async listByOwningAgent(owningAgentId) {
      const rows = await db
        .select()
        .from(table)
        .where(eq(table.owningAgentId, owningAgentId));
      return rows.map(fromRow);
    },

    async listExpired(now) {
      const rows = await db
        .select()
        .from(table)
        .where(lt(table.expiresAt, now));
      return rows.map(fromRow);
    },

    async listAgentIds() {
      const rows = await db.select({ id: table.agentId }).from(table);
      return rows.map((r) => r.id);
    },

    async listOwningAgentIds() {
      const rows = await db
        .selectDistinct({ id: table.owningAgentId })
        .from(table);
      return rows.map((r) => r.id);
    },

    async findByName(owningAgentId, name) {
      const [row] = await db
        .select()
        .from(table)
        .where(
          and(eq(table.owningAgentId, owningAgentId), eq(table.name, name)),
        );
      return row ? fromRow(row) : null;
    },

    async update(agentId, patch) {
      if (Object.keys(patch).length === 0) return;
      await db.update(table).set(patch).where(eq(table.agentId, agentId));
    },

    async delete(agentId) {
      await db.delete(table).where(eq(table.agentId, agentId));
    },

    forOwningAgent(owningAgentId, fn) {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(pg_catalog.hashtext(${`environments:${owningAgentId}`}))`,
        );
        return fn();
      });
    },
  };
}

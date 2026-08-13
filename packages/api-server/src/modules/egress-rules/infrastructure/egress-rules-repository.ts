import { and, desc, eq, inArray, sql, type Db } from "db";
import { egressRules } from "db";
import type {
  EgressPreset,
  EgressRuleSource,
  RuleVerdict,
} from "api-server-api";
import type { EgressRuleRow } from "../domain/types.js";

export interface EgressRulesRepository {
  findMatch(
    agentId: string,
    host: string,
    method: string,
    path: string,
  ): Promise<EgressRuleRow | null>;
  hasUserOwnedRuleForHost(agentId: string, host: string): Promise<boolean>;
  listConnectionDerivedForAgent(agentId: string): Promise<EgressRuleRow[]>;
  revokePresetRowsForAgent(agentId: string): Promise<void>;
  getPresetForAgent(agentId: string): Promise<EgressPreset>;
  getById(id: string): Promise<EgressRuleRow | null>;
  getActiveByTuple(
    agentId: string,
    host: string,
    method: string,
    pathPattern: string,
  ): Promise<EgressRuleRow | null>;
  insert(row: NewEgressRule): Promise<EgressRuleRow>;
  insertOrPromoteFromPreset(row: NewEgressRule): Promise<EgressRuleRow>;
  updateTakeOwnership(input: TakeOwnershipInput): Promise<EgressRuleRow | null>;
  listForAgent(agentId: string): Promise<EgressRuleRow[]>;
  reassignActiveSource(
    agentId: string,
    fromSources: string[],
    toSource: EgressRuleSource,
  ): Promise<void>;
  revoke(id: string): Promise<void>;
  deleteForAgent(agentId: string): Promise<void>;
  listDistinctAgentIds(): Promise<string[]>;
  listActiveForPromotionScan(): Promise<
    Array<{
      agentId: string;
      host: string;
      method: string;
      pathPattern: string;
      port?: number;
      source: string;
    }>
  >;
}

export interface NewEgressRule {
  id: string;
  agentId: string;
  host: string;
  port?: number;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
  source: EgressRuleSource;
}

export interface TakeOwnershipInput {
  id: string;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
  source: Extract<EgressRuleSource, "manual" | "inbox">;
}

type RawRule = {
  id: string;
  agentId: string;
  host: string;
  port: number | null;
  method: string;
  pathPattern: string;
  verdict: string;
  decidedBy: string;
  decidedAt: Date | string;
  status: string;
  source: string;
} & Record<string, unknown>;

function toRow(r: RawRule): EgressRuleRow {
  return {
    id: r.id,
    agentId: r.agentId,
    host: r.host,
    ...(r.port ? { port: r.port } : {}),
    method: r.method,
    pathPattern: r.pathPattern,
    verdict: r.verdict as RuleVerdict,
    decidedBy: r.decidedBy,
    decidedAt:
      r.decidedAt instanceof Date ? r.decidedAt : new Date(r.decidedAt),
    status: r.status as "active" | "revoked",
    source: r.source as EgressRuleSource,
  };
}

export function createEgressRulesRepository(db: Db): EgressRulesRepository {
  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(egressRules)
        .where(eq(egressRules.id, id));
      return rows.length ? toRow(rows[0] as RawRule) : null;
    },

    async getActiveByTuple(agentId, host, method, pathPattern) {
      const rows = await db
        .select()
        .from(egressRules)
        .where(
          and(
            eq(egressRules.agentId, agentId),
            eq(egressRules.host, host),
            eq(egressRules.method, method),
            eq(egressRules.pathPattern, pathPattern),
            eq(egressRules.status, "active"),
          ),
        );
      return rows.length ? toRow(rows[0] as RawRule) : null;
    },

    async findMatch(agentId, host, method, path) {
      const rows = await db.execute<RawRule>(sql`
        SELECT id, agent_id AS "agentId", host, port, method, path_pattern AS "pathPattern",
               verdict, decided_by AS "decidedBy", decided_at AS "decidedAt", status, source
        FROM ${egressRules}
        WHERE agent_id = ${agentId}
          AND (host = ${host} OR host = '*')
          AND status = 'active'
          AND (method = ${method} OR method = '*')
          AND ${path} LIKE replace(path_pattern, '*', '%')
        ORDER BY
          CASE WHEN host = '*' THEN 1 ELSE 0 END,
          CASE WHEN method = '*' THEN 1 ELSE 0 END,
          CASE WHEN path_pattern = '*' THEN 1 ELSE 0 END,
          length(path_pattern) DESC
        LIMIT 1
      `);
      const list = rows as unknown as RawRule[];
      return list.length ? toRow(list[0]!) : null;
    },

    async hasUserOwnedRuleForHost(agentId, host) {
      const rows = await db.execute<{ exists: boolean }>(sql`
        SELECT 1 AS exists
        FROM ${egressRules}
        WHERE agent_id = ${agentId}
          AND host = ${host}
          AND status = 'active'
          AND source IN ('manual', 'inbox')
        LIMIT 1
      `);
      return (rows as unknown as Array<unknown>).length > 0;
    },

    async listConnectionDerivedForAgent(agentId) {
      const rows = await db.execute<RawRule>(sql`
        SELECT id, agent_id AS "agentId", host, port, method, path_pattern AS "pathPattern",
               verdict, decided_by AS "decidedBy", decided_at AS "decidedAt", status, source
        FROM ${egressRules}
        WHERE agent_id = ${agentId}
          AND status = 'active'
          AND source LIKE 'connection:%'
      `);
      return (rows as unknown as RawRule[]).map(toRow);
    },

    async revokePresetRowsForAgent(agentId) {
      await db.execute(sql`
        UPDATE ${egressRules}
        SET status = 'revoked'
        WHERE agent_id = ${agentId}
          AND status = 'active'
          AND source LIKE 'preset:%'
      `);
    },

    async getPresetForAgent(agentId) {
      const rows = await db.execute<{ source: string }>(sql`
        SELECT DISTINCT source
        FROM ${egressRules}
        WHERE agent_id = ${agentId}
          AND status = 'active'
          AND source LIKE 'preset:%'
      `);
      const sources = (rows as unknown as Array<{ source: string }>).map(
        (r) => r.source,
      );
      if (sources.includes("preset:all")) return "all";
      if (sources.includes("preset:trusted")) return "trusted";
      return "none";
    },

    async insert(row) {
      const inserted = await db
        .insert(egressRules)
        .values({
          id: row.id,
          agentId: row.agentId,
          host: row.host,
          port: row.port ?? null,
          method: row.method,
          pathPattern: row.pathPattern,
          verdict: row.verdict,
          decidedBy: row.decidedBy,
          source: row.source,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length) return toRow(inserted[0] as RawRule);
      const existing = await this.getActiveByTuple(
        row.agentId,
        row.host,
        row.method,
        row.pathPattern,
      );
      if (!existing)
        throw new Error(
          "egress-rules: insert returned no row and no match found",
        );
      return existing;
    },

    async insertOrPromoteFromPreset(row) {
      const inserted = await db
        .insert(egressRules)
        .values({
          id: row.id,
          agentId: row.agentId,
          host: row.host,
          port: row.port ?? null,
          method: row.method,
          pathPattern: row.pathPattern,
          verdict: row.verdict,
          decidedBy: row.decidedBy,
          source: row.source,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length) return toRow(inserted[0] as RawRule);
      const promoted = await db.execute<RawRule>(sql`
        UPDATE ${egressRules}
        SET source = ${row.source}, decided_by = ${row.decidedBy}
        WHERE agent_id = ${row.agentId}
          AND host = ${row.host}
          AND method = ${row.method}
          AND path_pattern = ${row.pathPattern}
          AND status = 'active'
          AND source LIKE 'preset:%'
        RETURNING id, agent_id AS "agentId", host, port, method, path_pattern AS "pathPattern",
                  verdict, decided_by AS "decidedBy", decided_at AS "decidedAt", status, source
      `);
      const promotedRows = promoted as unknown as RawRule[];
      if (promotedRows.length) return toRow(promotedRows[0]!);
      const existing = await this.getActiveByTuple(
        row.agentId,
        row.host,
        row.method,
        row.pathPattern,
      );
      if (!existing)
        throw new Error("egress-rules: insertOrPromoteFromPreset found no row");
      return existing;
    },

    async updateTakeOwnership(input) {
      const updated = await db
        .update(egressRules)
        .set({
          method: input.method,
          pathPattern: input.pathPattern,
          verdict: input.verdict,
          decidedBy: input.decidedBy,
          source: input.source,
        })
        .where(
          and(eq(egressRules.id, input.id), eq(egressRules.status, "active")),
        )
        .returning();
      return updated.length ? toRow(updated[0] as RawRule) : null;
    },

    async listForAgent(agentId) {
      const rows = await db
        .select()
        .from(egressRules)
        .where(
          and(
            eq(egressRules.agentId, agentId),
            eq(egressRules.status, "active"),
          ),
        )
        .orderBy(desc(egressRules.decidedAt));
      return rows.map((r) => toRow(r as RawRule));
    },

    async listActiveForPromotionScan() {
      const rows = await db
        .select({
          agentId: egressRules.agentId,
          host: egressRules.host,
          method: egressRules.method,
          pathPattern: egressRules.pathPattern,
          port: egressRules.port,
          source: egressRules.source,
        })
        .from(egressRules)
        .where(eq(egressRules.status, "active"));
      return rows.map((r) => ({
        agentId: r.agentId,
        host: r.host,
        method: r.method,
        pathPattern: r.pathPattern,
        source: r.source,
        ...(r.port != null ? { port: r.port } : {}),
      }));
    },

    async reassignActiveSource(agentId, fromSources, toSource) {
      if (fromSources.length === 0) return;
      await db
        .update(egressRules)
        .set({ source: toSource })
        .where(
          and(
            eq(egressRules.agentId, agentId),
            eq(egressRules.status, "active"),
            inArray(egressRules.source, fromSources),
          ),
        );
    },

    async revoke(id) {
      await db
        .update(egressRules)
        .set({ status: "revoked" })
        .where(eq(egressRules.id, id));
    },

    async deleteForAgent(agentId) {
      await db.delete(egressRules).where(eq(egressRules.agentId, agentId));
    },

    async listDistinctAgentIds() {
      const rows = await db.execute<{ agent_id: string }>(sql`
        SELECT DISTINCT agent_id FROM ${egressRules}
      `);
      return (rows as unknown as Array<{ agent_id: string }>).map(
        (r) => r.agent_id,
      );
    },
  };
}

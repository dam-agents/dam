import { and, desc, eq, sql, type Db } from "db";
import { egressRules } from "db";
import type { EgressRuleSource, RuleVerdict } from "api-server-api";
import type { EgressRuleRow } from "../domain/types.js";

export interface EgressRulesRepository {
  /**
   * Match precedence (most-specific wins):
   *   1. exact method + exact path
   *   2. exact method + path glob (`/foo*` etc., translated to SQL LIKE)
   *   3. method `*` + exact path
   *   4. method `*` + path glob
   *   5. method `*` + path `*`  (the "allow this entire host" rule)
   * If multiple rules tie, the longest `path_pattern` wins as a tie-break —
   * an exact deny on `/v1/admin` beats an allow on `/v1/*`. Done in SQL to
   * keep the read in one round-trip on the egress hot path.
   */
  findMatch(agentId: string, host: string, method: string, path: string): Promise<EgressRuleRow | null>;
  /** True if any active manual or inbox rule covers `(agent, host)` —
   *  used by the connection grant lifecycle to skip the broad auto-insert
   *  when the user has already taken explicit ownership of the host. */
  hasUserOwnedRuleForHost(agentId: string, host: string): Promise<boolean>;
  /** Active rules with `source LIKE 'connection:%'` for the agent. Used by
   *  the connection-rules sync to compute add/revoke diffs without scanning
   *  the full table. */
  listConnectionDerivedForAgent(agentId: string): Promise<EgressRuleRow[]>;
  /** Revokes all active rows with `source LIKE 'preset:%'` for the agent.
   *  Manual and connection-derived rows are untouched. Used by `applyPreset`
   *  so switching presets sweeps the previous preset's auto-added rows. */
  revokePresetRowsForAgent(agentId: string): Promise<void>;
  getById(id: string): Promise<EgressRuleRow | null>;
  insert(row: NewEgressRule): Promise<EgressRuleRow>;
  /** Promotes the row's source to `manual` regardless of prior origin. */
  updatePromoteToManual(input: PromoteToManualInput): Promise<EgressRuleRow | null>;
  listForAgent(agentId: string): Promise<EgressRuleRow[]>;
  revoke(id: string): Promise<void>;
}

export interface NewEgressRule {
  id: string;
  agentId: string;
  host: string;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
  source: EgressRuleSource;
}

export interface PromoteToManualInput {
  id: string;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
}

type RawRule = {
  id: string;
  agentId: string;
  host: string;
  method: string;
  pathPattern: string;
  verdict: string;
  decidedBy: string;
  decidedAt: Date;
  status: string;
  source: string;
} & Record<string, unknown>;

function toRow(r: RawRule): EgressRuleRow {
  return {
    id: r.id,
    agentId: r.agentId,
    host: r.host,
    method: r.method,
    pathPattern: r.pathPattern,
    verdict: r.verdict as RuleVerdict,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    status: r.status as "active" | "revoked",
    source: r.source as EgressRuleSource,
  };
}

export function createEgressRulesRepository(db: Db): EgressRulesRepository {
  return {
    async getById(id) {
      const rows = await db.select().from(egressRules).where(eq(egressRules.id, id));
      return rows.length ? toRow(rows[0] as RawRule) : null;
    },

    async findMatch(agentId, host, method, path) {
      const rows = await db.execute<RawRule>(sql`
        SELECT id, agent_id AS "agentId", host, method, path_pattern AS "pathPattern",
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
        SELECT id, agent_id AS "agentId", host, method, path_pattern AS "pathPattern",
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

    async insert(row) {
      const inserted = await db.insert(egressRules).values({
        id: row.id,
        agentId: row.agentId,
        host: row.host,
        method: row.method,
        pathPattern: row.pathPattern,
        verdict: row.verdict,
        decidedBy: row.decidedBy,
        source: row.source,
      }).onConflictDoNothing().returning();
      if (inserted.length) return toRow(inserted[0] as RawRule);
      const existing = await this.findMatch(row.agentId, row.host, row.method, row.pathPattern);
      if (!existing) throw new Error("egress-rules: insert returned no row and no match found");
      return existing;
    },

    async updatePromoteToManual(input) {
      const updated = await db
        .update(egressRules)
        .set({
          method: input.method,
          pathPattern: input.pathPattern,
          verdict: input.verdict,
          decidedBy: input.decidedBy,
          source: "manual",
        })
        .where(and(eq(egressRules.id, input.id), eq(egressRules.status, "active")))
        .returning();
      return updated.length ? toRow(updated[0] as RawRule) : null;
    },

    async listForAgent(agentId) {
      const rows = await db
        .select()
        .from(egressRules)
        .where(and(eq(egressRules.agentId, agentId), eq(egressRules.status, "active")))
        .orderBy(desc(egressRules.decidedAt));
      return rows.map((r) => toRow(r as RawRule));
    },

    async revoke(id) {
      await db.update(egressRules).set({ status: "revoked" }).where(eq(egressRules.id, id));
    },
  };
}

import { eq, sql, webSearchRules, type Db } from "db";
import type { WebSearchVerdict } from "api-server-api";
import type { WebSearchRuleRow } from "../domain/types.js";

export interface WebSearchRepository {
  ruleOf(agentId: string): Promise<WebSearchRuleRow | null>;
  writeRule(input: {
    agentId: string;
    verdict: WebSearchVerdict;
    decidedBy: string;
  }): Promise<WebSearchRuleRow>;
  clearRule(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

function verdictOf(value: string): WebSearchVerdict {
  return value === "allow" ? "allow" : "deny";
}

export function createWebSearchRepository(db: Db): WebSearchRepository {
  return {
    async ruleOf(agentId) {
      const rows = await db
        .select()
        .from(webSearchRules)
        .where(eq(webSearchRules.agentId, agentId))
        .limit(1);
      const row = rows[0];
      return row ? { ...row, verdict: verdictOf(row.verdict) } : null;
    },

    async writeRule({ agentId, verdict, decidedBy }) {
      const [row] = await db
        .insert(webSearchRules)
        .values({ agentId, verdict, decidedBy })
        .onConflictDoUpdate({
          target: webSearchRules.agentId,
          set: { verdict, decidedBy, decidedAt: sql`now()` },
        })
        .returning();
      return { ...row!, verdict: verdictOf(row!.verdict) };
    },

    async clearRule(agentId) {
      await db
        .delete(webSearchRules)
        .where(eq(webSearchRules.agentId, agentId));
    },

    async listAgentIds() {
      const rows = await db
        .select({ agentId: webSearchRules.agentId })
        .from(webSearchRules);
      return rows.map((row) => row.agentId);
    },
  };
}

import { agentCostReviews, and, eq, gte, inArray, or, type Db } from "db";

const ACCEPTED = "accepted";
const DISMISSED = "dismissed";

export interface CostReviewsRepository {
  closed(agentIds: readonly string[], laterSince: Date): Promise<Set<string>>;
  accepted(agentId: string): Promise<boolean>;
  accept(agentId: string, at: Date): Promise<boolean>;
  dismiss(agentIds: readonly string[], at: Date): Promise<string[]>;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's latest answer to the cost-review
 * offer, one row per Agent. Accepting is final: the row then never changes.
 * "Later" only closes the offer for a while, so a later answer moves its time
 * forward or turns it into an acceptance, and `closed` counts it only while
 * it is newer than the given time.
 */
export function createCostReviewsRepository(db: Db): CostReviewsRepository {
  return {
    async closed(agentIds, laterSince) {
      if (agentIds.length === 0) return new Set();
      const rows = await db
        .select({ agentId: agentCostReviews.agentId })
        .from(agentCostReviews)
        .where(
          and(
            inArray(agentCostReviews.agentId, [...agentIds]),
            or(
              eq(agentCostReviews.decision, ACCEPTED),
              gte(agentCostReviews.decidedAt, laterSince),
            ),
          ),
        );
      return new Set(rows.map((r) => r.agentId));
    },

    async accepted(agentId) {
      const [row] = await db
        .select({ agentId: agentCostReviews.agentId })
        .from(agentCostReviews)
        .where(
          and(
            eq(agentCostReviews.agentId, agentId),
            eq(agentCostReviews.decision, ACCEPTED),
          ),
        );
      return row !== undefined;
    },

    async accept(agentId, at) {
      const rows = await db
        .insert(agentCostReviews)
        .values({ agentId, decision: ACCEPTED, decidedAt: at })
        .onConflictDoUpdate({
          target: agentCostReviews.agentId,
          set: { decision: ACCEPTED, decidedAt: at },
          setWhere: eq(agentCostReviews.decision, DISMISSED),
        })
        .returning({ agentId: agentCostReviews.agentId });
      return rows.length > 0;
    },

    async dismiss(agentIds, at) {
      if (agentIds.length === 0) return [];
      const rows = await db
        .insert(agentCostReviews)
        .values(
          agentIds.map((agentId) => ({
            agentId,
            decision: DISMISSED,
            decidedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: agentCostReviews.agentId,
          set: { decidedAt: at },
          setWhere: eq(agentCostReviews.decision, DISMISSED),
        })
        .returning({ agentId: agentCostReviews.agentId });
      return rows.map((r) => r.agentId);
    },

    async listAgentIds() {
      const rows = await db
        .select({ agentId: agentCostReviews.agentId })
        .from(agentCostReviews);
      return rows.map((r) => r.agentId);
    },

    async deleteForAgent(agentId) {
      await db
        .delete(agentCostReviews)
        .where(eq(agentCostReviews.agentId, agentId));
    },
  };
}

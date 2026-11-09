import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  sql,
  agentSessions,
  agents as agentsTable,
  spendDaily,
  type Db,
} from "db";
import { supportsCostReview } from "agent-runtime-api";
import type { SpendUnit } from "api-server-api";

import { offerWindowStart, type OfferCandidate } from "../domain/offers.js";

const PAID: SpendUnit = "usd";
const BOBCOIN: SpendUnit = "bobcoin";
const UNATTENDED_SESSION_TYPES = [
  "schedule_cron",
  "schedule_once",
  "channel_slack",
  "channel_telegram",
];

export interface OwnedAgent {
  id: string;
  createdAt: Date;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the facts the cost-review offer is decided on,
 * read from the database alone so a sleeping Agent is never woken to draw
 * the bell. Spend comes from the daily Metered Spend rows the owner pays,
 * sub-agents' calls included; a day counts as unattended when the Agent's own
 * scheduled or channel Session spent on it. Sub-agents a session spawned are
 * never candidates themselves.
 */
export function createOfferCandidatesReader(
  db: Db,
): (
  ownerSub: string,
  open: readonly OwnedAgent[],
  now: Date,
) => Promise<OfferCandidate[]> {
  return async (ownerSub, open, now) => {
    if (open.length === 0) return [];
    const ids = open.map((a) => a.id);
    const [rows, spend] = await Promise.all([
      db
        .select({
          id: agentsTable.id,
          capabilities: agentsTable.runtimeCapabilities,
        })
        .from(agentsTable)
        .where(
          and(
            inArray(agentsTable.id, ids),
            isNull(agentsTable.deletedAt),
            isNull(agentsTable.spawnedByAgentId),
          ),
        ),
      db
        .select({
          agentId: spendDaily.payerAgentId,
          paid: sql<string>`coalesce(sum(${spendDaily.costMicros}) filter (where ${spendDaily.unit} = ${PAID}), 0)`,
          bobcoins: sql<string>`coalesce(sum(${spendDaily.costMicros}) filter (where ${spendDaily.unit} = ${BOBCOIN}), 0)`,
          unattendedDays: sql<string>`count(distinct ${spendDaily.day}) filter (where ${inArray(agentSessions.type, UNATTENDED_SESSION_TYPES)})`,
        })
        .from(spendDaily)
        .leftJoin(
          agentSessions,
          and(
            eq(agentSessions.agentId, spendDaily.payerAgentId),
            eq(agentSessions.sessionId, spendDaily.sessionId),
          ),
        )
        .where(
          and(
            eq(spendDaily.ownerSub, ownerSub),
            gte(spendDaily.day, offerWindowStart(now)),
            inArray(spendDaily.payerAgentId, ids),
          ),
        )
        .groupBy(spendDaily.payerAgentId),
    ]);
    const createdAt = new Map(open.map((a) => [a.id, a.createdAt]));
    const spendOf = new Map(spend.map((s) => [s.agentId, s]));
    return rows.flatMap((r) => {
      const born = createdAt.get(r.id);
      const s = spendOf.get(r.id);
      if (!born || !s) return [];
      return [
        {
          agentId: r.id,
          createdAt: born,
          supportsReview: supportsCostReview(r.capabilities),
          paidUsdMicros: Number(s.paid),
          bobcoinMicros: Number(s.bobcoins),
          unattendedDays: Number(s.unattendedDays),
        },
      ];
    });
  };
}

export function createCostReviewSupportReader(
  db: Db,
): (agentId: string) => Promise<boolean> {
  return async (agentId) => {
    const [row] = await db
      .select({ capabilities: agentsTable.runtimeCapabilities })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    return supportsCostReview(row?.capabilities);
  };
}

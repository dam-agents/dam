import { TRPCError } from "@trpc/server";
import type { SpendLimitView, SpendService, SpendTotal } from "api-server-api";
import { utcDay } from "../domain/ledger.js";
import { limitCounter, readLimit, type SpendLimit } from "../domain/limits.js";
import { nextUtcMidnight } from "../domain/refusal.js";
import type { SpendLedger } from "../infrastructure/spend-ledger.js";
import type { SpendLimits } from "../infrastructure/spend-limits.js";
import type { DayTotals } from "./spend-check.js";

export function createSpendService(deps: {
  ledger: SpendLedger;
  limits: SpendLimits;
  totals: DayTotals;
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  ownerSub: string;
  agentBinding: readonly string[] | "*";
}): SpendService {
  const requireOwned = async (agentId: string) => {
    if (!(await deps.isAgentOwnedBy(agentId, deps.ownerSub))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
    }
  };

  const limitView = async (
    limit: SpendLimit,
    day: string,
  ): Promise<SpendLimitView> => {
    const reading = readLimit(
      limit,
      await deps.totals.spentToday(limitCounter(limit, day)),
    );
    return {
      id: limit.id,
      scope: limit.scope,
      unit: limit.unit,
      amountMicros: limit.amountMicros,
      extensions: limit.extensions,
      effectiveMicros: reading.effectiveMicros,
      spentMicros: reading.spentMicros,
      leftMicros: reading.leftMicros,
      state: reading.state,
    };
  };

  const scopedAgents = (agentId: string | undefined) =>
    agentId ? [agentId] : deps.agentBinding === "*" ? null : deps.agentBinding;

  return {
    async daily({ agentId, from, to }) {
      return deps.ledger.daily({
        ownerSub: deps.ownerSub,
        agentIds: scopedAgents(agentId),
        from,
        to,
      });
    },

    async status(input) {
      const now = new Date();
      const day = utcDay(now);
      const agentId = input?.agentId;
      if (agentId) await requireOwned(agentId);
      const limits = agentId
        ? (await deps.limits.forAgent(agentId, day)).filter(
            (limit) => limit.ownerSub === deps.ownerSub,
          )
        : [];
      const rows = await deps.ledger.daily({
        ownerSub: deps.ownerSub,
        agentIds: scopedAgents(agentId),
        from: day,
        to: day,
      });
      const spent = new Map<string, SpendTotal>();
      for (const row of rows) {
        const total = spent.get(row.unit) ?? {
          unit: row.unit,
          costMicros: 0,
          estimatedCalls: 0,
        };
        total.costMicros += row.costMicros;
        total.estimatedCalls += row.estimatedCalls;
        spent.set(row.unit, total);
      }
      return {
        day,
        resetsAt: nextUtcMidnight(now).toISOString(),
        limits: await Promise.all(limits.map((limit) => limitView(limit, day))),
        spent: [...spent.values()],
      };
    },

    async setLimit({ scope, amountMicros }) {
      await requireOwned(scope.agentId);
      if (amountMicros === null) {
        await deps.limits.clear(deps.ownerSub, scope);
        return;
      }
      await deps.limits.set({
        ownerSub: deps.ownerSub,
        scope,
        unit: "usd",
        amountMicros,
      });
    },
  };
}

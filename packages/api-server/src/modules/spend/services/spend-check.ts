import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import type { ApiDialect } from "../domain/call.js";
import {
  UNKNOWN_CONNECTION,
  UNKNOWN_MODEL,
  utcDay,
  type DayCounter,
} from "../domain/ledger.js";
import {
  limitCounter,
  limitsOnCall,
  readLimit,
  type LimitScope,
} from "../domain/limits.js";
import { refusalFor, softLimitText, type Refusal } from "../domain/refusal.js";
import { payingProvider, unitOf, type SpendUnit } from "../domain/units.js";
import type { DayCounters } from "../infrastructure/day-counters.js";
import type { SpendLimits } from "../infrastructure/spend-limits.js";
import type { SpendLedger } from "../infrastructure/spend-ledger.js";
import type { SpendIngest, StartedCall } from "./spend-ingest.js";

export type CheckedCall = StartedCall & { readonly dialect: ApiDialect };

export interface SpendLimitQuestion {
  readonly limitId: string;
  readonly scope: LimitScope;
  readonly unit: SpendUnit;
  readonly day: string;
  readonly amountMicros: number;
  readonly extensions: number;
}

export type SpendVerdict =
  | { readonly verdict: "allow" }
  | {
      readonly verdict: "refuse";
      readonly response: Refusal;
      readonly questions: readonly SpendLimitQuestion[];
    };

export interface SpendCheck {
  checkCall(call: CheckedCall): Promise<SpendVerdict>;
}

export interface DayTotals {
  spentToday(counter: DayCounter): Promise<number>;
}

export function createDayTotals(deps: {
  counters: DayCounters;
  ledger: SpendLedger;
}): DayTotals {
  return {
    async spentToday(counter) {
      try {
        const counted = await deps.counters.read(counter);
        if (counted !== null) return counted;
        const total = await deps.ledger.total(counter);
        await deps.counters.setIfMissing(counter, total);
        return total;
      } catch (err) {
        getLogger().warn(
          { counter, reason: formatError(err) },
          "spend.counter_read_failed",
        );
        return deps.ledger.total(counter);
      }
    },
  };
}

export function createSpendCheck(deps: {
  limits: SpendLimits;
  totals: DayTotals;
  ledger: SpendLedger;
  ingest: SpendIngest;
  brandName: string;
}): SpendCheck {
  return {
    async checkCall(call) {
      const day = utcDay(call.startedAt);
      const { provider } = payingProvider(call.providers);
      const unit = unitOf(provider);
      const limits = limitsOnCall(await deps.limits.forAgent(call.payer, day), {
        payer: call.payer,
        unit,
      });
      const readings = await Promise.all(
        limits.map(async (limit) =>
          readLimit(
            limit,
            await deps.totals.spentToday(limitCounter(limit, day)),
          ),
        ),
      );
      const reached = readings.filter((reading) => reading.state === "reached");
      if (reached.length === 0) {
        await deps.ingest.callStarted(call);
        return { verdict: "allow" };
      }

      await deps.ledger
        .addRefusal({
          day,
          payer: call.payer,
          ownerSub: call.ownerSub,
          connectionId: call.connectionId ?? UNKNOWN_CONNECTION,
          model: UNKNOWN_MODEL,
          provider,
          unit,
        })
        .catch((err: unknown) =>
          getLogger().warn(
            { callId: call.callId, reason: formatError(err) },
            "spend.refusal_not_counted",
          ),
        );
      return {
        verdict: "refuse",
        response: refusalFor(
          call.dialect,
          softLimitText(deps.brandName),
          call.startedAt,
        ),
        questions: reached.map(({ limit }) => ({
          limitId: limit.id,
          scope: limit.scope,
          unit: limit.unit,
          day,
          amountMicros: limit.amountMicros,
          extensions: limit.extensions,
        })),
      };
    },
  };
}

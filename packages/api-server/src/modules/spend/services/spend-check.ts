import { match } from "ts-pattern";
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
  blockOf,
  ceilingCounter,
  countsInCeiling,
  limitCounter,
  limitsOnCall,
  readCeiling,
  readLimit,
  type CeilingReading,
  type LimitedCall,
  type LimitReading,
  type LimitScope,
  type SpendBlock,
} from "../domain/limits.js";
import {
  CEILING_TEXT,
  refusalFor,
  softLimitText,
  type Refusal,
} from "../domain/refusal.js";
import { payingProvider, unitOf, type SpendUnit } from "../domain/units.js";
import type { DayCounters } from "../infrastructure/day-counters.js";
import type { SpendLimits } from "../infrastructure/spend-limits.js";
import type { SpendLedger } from "../infrastructure/spend-ledger.js";
import type { SpendCeilings } from "../infrastructure/spend-ceilings.js";
import {
  checkedSession,
  type AgentOwners,
  type SessionOwnership,
  type SpendIngest,
  type StartedCall,
} from "./spend-ingest.js";

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
      readonly reason: SpendBlock;
      readonly response: Refusal;
      readonly questions: readonly SpendLimitQuestion[];
    };

export interface SpendHold {
  readonly reason: SpendBlock;
  readonly ownerSub: string;
  readonly questions: readonly SpendLimitQuestion[];
}

export interface SpendCheck {
  checkCall(call: CheckedCall): Promise<SpendVerdict>;
  holdFor(input: {
    payer: string;
    connectionId?: string;
  }): Promise<SpendHold | null>;
}

function questionsOf(
  limits: readonly LimitReading[],
  day: string,
): SpendLimitQuestion[] {
  return limits
    .filter((reading) => reading.state === "reached")
    .map(({ limit }) => ({
      limitId: limit.id,
      scope: limit.scope,
      unit: limit.unit,
      day,
      amountMicros: limit.amountMicros,
      extensions: limit.extensions,
    }));
}

export interface DayTotals {
  spentToday(counter: DayCounter): Promise<number>;
}

export interface GrantedConnections {
  templateOf(agentId: string, connectionId: string): Promise<string | null>;
  ownedTemplateOf(
    ownerSub: string,
    connectionId: string,
  ): Promise<string | null>;
  grantedTo(
    agentId: string,
  ): Promise<readonly { connectionId: string; templateId: string }[]>;
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
  ceilings: SpendCeilings;
  totals: DayTotals;
  ledger: SpendLedger;
  ingest: SpendIngest;
  owners: AgentOwners;
  sessions: SessionOwnership;
  connections: GrantedConnections;
  brandName: string;
}): SpendCheck {
  const read = async (
    call: LimitedCall,
    day: string,
  ): Promise<{
    limits: readonly LimitReading[];
    ceiling: CeilingReading | null;
  }> => {
    const [limits, ceiling] = await Promise.all([
      deps.limits.applying(
        { agentId: call.payer, ownerSub: call.ownerSub },
        day,
      ),
      countsInCeiling(call.unit)
        ? deps.ceilings.forOwner(call.ownerSub)
        : Promise.resolve(null),
    ]);
    const [readings, ceilingReading] = await Promise.all([
      Promise.all(
        limitsOnCall(limits, call).map(async (limit) =>
          readLimit(
            limit,
            await deps.totals.spentToday(limitCounter(limit, day)),
          ),
        ),
      ),
      ceiling
        ? deps.totals
            .spentToday(ceilingCounter(call.ownerSub, day))
            .then((spent) => readCeiling(ceiling, spent))
        : Promise.resolve(null),
    ]);
    return { limits: readings, ceiling: ceilingReading };
  };

  return {
    async checkCall(call) {
      const day = utcDay(call.startedAt);
      const { provider } = payingProvider(call.providers);
      const unit = unitOf(provider);
      const readings = await read(
        {
          payer: call.payer,
          ownerSub: call.ownerSub,
          connectionId: call.connectionId,
          unit,
        },
        day,
      );
      const block = blockOf(readings.ceiling, readings.limits);
      if (block === null) {
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
          sessionId: await checkedSession(
            deps.sessions,
            call.agentId,
            call.sessionId,
          ),
          callingAgentId: call.agentId,
          provider,
          unit,
        })
        .catch((err: unknown) =>
          getLogger().warn(
            { callId: call.callId, reason: formatError(err) },
            "spend.refusal_not_counted",
          ),
        );
      return match(block)
        .with("ceiling", (): SpendVerdict => ({
          verdict: "refuse",
          reason: "ceiling",
          response: refusalFor(
            { dialect: call.dialect, provider },
            CEILING_TEXT,
            call.startedAt,
          ),
          questions: [],
        }))
        .with("limit", (): SpendVerdict => ({
          verdict: "refuse",
          reason: "limit",
          response: refusalFor(
            { dialect: call.dialect, provider },
            softLimitText(deps.brandName),
            call.startedAt,
          ),
          questions: questionsOf(readings.limits, day),
        }))
        .exhaustive();
    },

    async holdFor({ payer, connectionId }) {
      const ownerSub = await deps.owners.ownerOf(payer);
      if (!ownerSub) return null;
      const template = connectionId
        ? await deps.connections.templateOf(payer, connectionId)
        : null;
      const day = utcDay(new Date());
      const readings = await read(
        {
          payer,
          ownerSub,
          connectionId: template ? (connectionId ?? null) : null,
          unit: template ? unitOf(template) : "usd",
        },
        day,
      );
      const reason = blockOf(readings.ceiling, readings.limits);
      if (reason === null) return null;
      return {
        reason,
        ownerSub,
        questions: reason === "limit" ? questionsOf(readings.limits, day) : [],
      };
    },
  };
}

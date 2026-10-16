import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import { measureCall, type CallRecord } from "../domain/call.js";
import { proxyCostDifference } from "../domain/cost.js";
import {
  amountsDelta,
  dayCountersOf,
  daysBefore,
  isZero,
  mapAmounts,
  utcDay,
  NO_SESSION,
  UNKNOWN_CONNECTION,
  UNKNOWN_MODEL,
  type CallAmounts,
  type SpendRow,
} from "../domain/ledger.js";
import type { PriceBook } from "../domain/prices.js";
import { payingProvider, unitOf } from "../domain/units.js";
import type { CallMeta, CallStates } from "../infrastructure/call-states.js";
import type { DayCounters } from "../infrastructure/day-counters.js";
import type { SpendLedger } from "../infrastructure/spend-ledger.js";

export interface AgentOwners {
  ownerOf(agentId: string): Promise<string | null>;
}

export interface SessionOwnership {
  has(agentId: string, sessionId: string): Promise<boolean>;
}

export type StartedCall = CallMeta & { readonly callId: string };

export interface SpendIngest {
  callStarted(call: StartedCall): Promise<void>;
  record(record: CallRecord): Promise<void>;
  settleUnrecordedCalls(): Promise<void>;
}

const UNRECORDED_AFTER_MS = 60 * 60 * 1000;
const UNRECORDED_BATCH = 500;
const REFERENCE_DAYS = 7;
const PROXY_COST_TOLERANCE = 0.05;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the stamp comes from the agent's pod, so a
 * Session counts only when the calling agent reported it to the Session
 * directory; any other stamp, or a failed check, counts as no Session. The
 * split is for display only, so the check never loses a call's spend.
 */
export async function checkedSession(
  sessions: SessionOwnership,
  agentId: string,
  sessionId: string | null,
): Promise<string> {
  if (!agentId || !sessionId) return NO_SESSION;
  try {
    return (await sessions.has(agentId, sessionId)) ? sessionId : NO_SESSION;
  } catch (err) {
    getLogger().warn(
      { agentId, sessionId, reason: formatError(err) },
      "spend.session_check_failed",
    );
    return NO_SESSION;
  }
}

export function createSpendIngest(deps: {
  priceBook: PriceBook;
  calls: CallStates;
  ledger: SpendLedger;
  counters: DayCounters;
  owners: AgentOwners;
  sessions: SessionOwnership;
}): SpendIngest {
  const log = () => getLogger();

  const countDay = async (row: SpendRow, deltaMicros: number) => {
    for (const counter of dayCountersOf(row)) {
      try {
        if (await deps.counters.addIfPresent(counter, deltaMicros)) continue;
        await deps.counters.setIfMissing(
          counter,
          await deps.ledger.total(counter),
        );
      } catch (err) {
        log().warn(
          { counter, reason: formatError(err) },
          "spend.counter_write_failed",
        );
        await deps.counters.drop(counter).catch(() => {});
      }
    }
  };

  const settle = async (
    callId: string,
    row: SpendRow,
    amounts: CallAmounts,
    final: boolean,
  ) => {
    const applied = await deps.calls.apply(callId, row, amounts, final);
    if (!applied) return;
    const delta = amountsDelta(amounts, applied.previous);
    if (!isZero(delta)) {
      try {
        await deps.ledger.add(applied.row, delta, amounts.costMicros);
      } catch (err) {
        await deps.calls.restore(callId, applied).catch(() => {});
        throw err;
      }
      if (delta.costMicros !== 0) await countDay(applied.row, delta.costMicros);
    }
    if (final) await deps.calls.release(callId);
  };

  const referenceCost = async (row: SpendRow) => {
    const within = (from: string) =>
      deps.ledger.highestCall({
        payer: row.payer,
        connectionId: row.connectionId,
        from,
        to: row.day,
      });
    const highest =
      (await within(row.day)) ??
      (await within(daysBefore(row.day, REFERENCE_DAYS - 1)));
    if (highest === null) {
      log().warn(
        { payer: row.payer, connectionId: row.connectionId, day: row.day },
        "spend.estimate_without_reference",
      );
    }
    return highest ?? 0;
  };

  const ownerOf = async (record: CallRecord) =>
    (await deps.owners.ownerOf(record.payer)) ??
    (await deps.calls.read(record.callId))?.meta?.ownerSub ??
    (await deps.owners.ownerOf(record.agentId));

  const settleUnrecorded = async (callId: string) => {
    if (!(await deps.calls.release(callId))) return;
    try {
      await settleReleased(callId);
    } catch (err) {
      await deps.calls.reclaim(callId).catch(() => {});
      throw err;
    }
  };

  const settleReleased = async (callId: string) => {
    const state = await deps.calls.read(callId);
    if (!state || state.final) return;
    if (state.row) {
      await settle(
        callId,
        state.row,
        { ...state.amounts, estimatedCalls: 1 },
        true,
      );
      return;
    }
    if (!state.meta) return;
    const { provider } = payingProvider(state.meta.providers);
    const row: SpendRow = {
      day: utcDay(state.meta.startedAt),
      payer: state.meta.payer,
      ownerSub: state.meta.ownerSub,
      connectionId: state.meta.connectionId ?? UNKNOWN_CONNECTION,
      model: UNKNOWN_MODEL,
      sessionId: await checkedSession(
        deps.sessions,
        state.meta.agentId,
        state.meta.sessionId,
      ),
      callingAgentId: state.meta.agentId,
      provider,
      unit: unitOf(provider),
    };
    const cost = await referenceCost(row);
    const estimate = mapAmounts((field) =>
      field === "costMicros"
        ? cost
        : field === "calls" || field === "estimatedCalls"
          ? 1
          : 0,
    );
    await settle(callId, row, estimate, true);
  };

  return {
    async callStarted(call) {
      await deps.calls
        .started(call.callId, call)
        .catch((err: unknown) =>
          log().warn(
            { callId: call.callId, reason: formatError(err) },
            "spend.call_start_not_noted",
          ),
        );
    },

    async record(record) {
      const measure = measureCall(record, deps.priceBook);
      if (measure.kind === "skip") return;
      if (measure.kind === "forget") {
        await deps.calls.forget(record.callId);
        return;
      }
      const ownerSub = await ownerOf(record);
      if (!ownerSub) {
        log().warn(
          { callId: record.callId, payer: record.payer },
          "spend.record_without_owner",
        );
        return;
      }
      const row: SpendRow = {
        day: utcDay(record.startedAt),
        payer: record.payer,
        ownerSub,
        connectionId: record.connectionId ?? UNKNOWN_CONNECTION,
        model: measure.model,
        sessionId: await checkedSession(
          deps.sessions,
          record.agentId,
          record.sessionId,
        ),
        callingAgentId: record.agentId,
        provider: measure.provider,
        unit: measure.unit,
      };
      const amounts = measure.needsReferenceCost
        ? { ...measure.amounts, costMicros: await referenceCost(row) }
        : measure.amounts;
      await settle(record.callId, row, amounts, record.final);
      if (record.final)
        log().debug(
          {
            callId: record.callId,
            agentId: record.agentId,
            sessionId: record.sessionId,
            harness: record.harness,
            durationMs: record.durationMs,
          },
          "spend.call_recorded",
        );

      const difference =
        record.final && measure.unit === "usd"
          ? proxyCostDifference(amounts.costMicros, record.proxyCost)
          : null;
      if (difference !== null && difference > PROXY_COST_TOLERANCE) {
        log().warn(
          {
            provider: measure.provider,
            model: measure.model,
            costMicros: amounts.costMicros,
            proxyCost: record.proxyCost,
          },
          "spend.proxy_cost_mismatch",
        );
      }
    },

    async settleUnrecordedCalls() {
      const overdue = await deps.calls.overdue(
        new Date(Date.now() - UNRECORDED_AFTER_MS),
        UNRECORDED_BATCH,
      );
      for (const callId of overdue) {
        await settleUnrecorded(callId).catch((err: unknown) =>
          log().error(
            { callId, reason: formatError(err) },
            "spend.unrecorded_call_failed",
          ),
        );
      }
    },
  };
}

import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import { emit, EventType } from "../../../events.js";
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

interface SettledAt {
  readonly startedAt: Date;
  readonly routerCallId?: string | null;
  readonly sessionId?: string | null;
}

export interface SpendIngest {
  callStarted(call: StartedCall): Promise<void>;
  record(record: CallRecord): Promise<void>;
  settleUnrecordedCalls(): Promise<void>;
  bookStampedCalls(): Promise<void>;
}

const UNRECORDED_AFTER_MS = 60 * 60 * 1000;
const UNRECORDED_BATCH = 500;
const STAMPED_BOOKING_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const STAMPED_BOOKING_BATCH = 200;
const REFERENCE_DAYS = 7;
const PROXY_COST_TOLERANCE = 0.05;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the stamp comes from the agent's machine, so a
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

  const putCall = (
    callId: string,
    row: SpendRow,
    amounts: CallAmounts,
    call: SettledAt,
  ) =>
    deps.ledger
      .putCall({
        callId,
        routerCallId: call.routerCallId ?? "",
        callingAgentId: row.callingAgentId,
        ownerSub: row.ownerSub,
        payer: row.payer,
        sessionId: row.sessionId,
        stampedSessionId:
          row.sessionId === NO_SESSION ? (call.sessionId ?? "") : "",
        connectionId: row.connectionId,
        providerTemplate: row.provider,
        model: row.model,
        startedAt: call.startedAt,
        unit: row.unit,
        costMicros: amounts.costMicros,
        uncachedInputTokens: amounts.uncachedInputTokens,
        outputTokens: amounts.outputTokens,
        cacheReadTokens: amounts.cacheReadTokens,
        cacheWrite5mTokens: amounts.cacheWrite5mTokens,
        cacheWrite1hTokens: amounts.cacheWrite1hTokens,
        webSearches: amounts.webSearches,
        durationMs: amounts.durationMs,
        estimated: amounts.estimatedCalls > 0,
      })
      .catch((err: unknown) =>
        log().warn(
          { callId, reason: formatError(err) },
          "spend.call_row_not_written",
        ),
      );

  const settle = async (
    callId: string,
    row: SpendRow,
    amounts: CallAmounts,
    final: boolean,
    call: SettledAt,
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
    if (!final) return;
    await deps.calls.release(callId);
    await putCall(callId, applied.row, amounts, call);
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
        {
          startedAt:
            state.meta?.startedAt ?? new Date(`${state.row.day}T00:00:00Z`),
          routerCallId: state.meta?.routerCallId ?? null,
          sessionId: state.meta?.sessionId ?? null,
        },
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
    await settle(callId, row, estimate, true, {
      startedAt: state.meta.startedAt,
      routerCallId: state.meta.routerCallId ?? null,
      sessionId: state.meta.sessionId ?? null,
    });
  };

  const bookStamp = async (
    {
      callingAgentId,
      sessionId,
    }: { callingAgentId: string; sessionId: string },
    since: Date,
  ): Promise<void> => {
    if (
      (await checkedSession(deps.sessions, callingAgentId, sessionId)) ===
      NO_SESSION
    )
      return;
    try {
      const moved = await deps.ledger.bookCalls({
        callingAgentId,
        sessionId,
        since,
      });
      for (const callId of moved)
        await deps.calls.rebook(callId, sessionId).catch(() => {});
      if (moved.length > 0)
        log().info(
          { agentId: callingAgentId, sessionId, calls: moved.length },
          "spend.calls_booked_late",
        );
    } catch (err) {
      log().error(
        { agentId: callingAgentId, sessionId, reason: formatError(err) },
        "spend.late_booking_failed",
      );
    }
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
      if (record.final)
        emit({
          type: EventType.GatewayCallEnded,
          payer: record.payer,
          providers: record.providers,
          status: record.status,
          refusedByGate: record.refusedByGate,
          endedAt: new Date(record.startedAt.getTime() + record.durationMs),
          callingAgentId: record.agentId,
          sessionId: record.sessionId,
        });
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
      await settle(record.callId, row, amounts, record.final, record);
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

      const uncached =
        amounts.cacheReadTokens +
          amounts.cacheWrite5mTokens +
          amounts.cacheWrite1hTokens ===
        0;
      const difference =
        record.final && measure.unit === "usd" && uncached
          ? proxyCostDifference(amounts.costMicros, record.proxyCost)
          : null;
      if (difference !== null && difference > PROXY_COST_TOLERANCE) {
        log().warn(
          {
            provider: measure.provider,
            model: measure.model,
            costMicros: amounts.costMicros,
            proxyCost: record.proxyCost.cost,
            proxyCostOriginal: record.proxyCost.original,
            proxyCostDiscount: record.proxyCost.discount,
            proxyCostMargin: record.proxyCost.margin,
            uncachedInputTokens: amounts.uncachedInputTokens,
            outputTokens: amounts.outputTokens,
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

    /**
     * UNIT_BOUNDARY_DESCRIPTION: books to its Session a settled call that
     * was metered before the agent's report of that Session reached the
     * directory, as when the report failed or came after the new Session's
     * wait for it ran out. The call row kept the stamp, so once the
     * directory knows the Session the call and its share of the daily
     * rollup move from no Session to it, and the call's state moves too in
     * case a late record still arrives for it. A stamp the agent never
     * reports stays with no Session and ages out of the window; each pass
     * walks every stamp in the window in key order, so such stamps never
     * crowd out the ones that the directory now knows.
     */
    async bookStampedCalls() {
      const since = new Date(Date.now() - STAMPED_BOOKING_WINDOW_MS);
      let after: { callingAgentId: string; sessionId: string } | null = null;
      for (;;) {
        const stamps = await deps.ledger.unbookedStamps({
          since,
          after,
          limit: STAMPED_BOOKING_BATCH,
        });
        for (const stamp of stamps) await bookStamp(stamp, since);
        if (stamps.length < STAMPED_BOOKING_BATCH) return;
        after = stamps.at(-1) ?? null;
      }
    },
  };
}

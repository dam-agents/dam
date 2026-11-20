import { CALL_ROWS_RETENTION_DAYS } from "api-server-api";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import { utcDay } from "../domain/ledger.js";
import type { PriceBook } from "../domain/prices.js";
import { repriceCall, type RepriceKind } from "../domain/reprice.js";
import type { CallStates } from "../infrastructure/call-states.js";
import type { PriceMetrics } from "../infrastructure/price-metrics.js";
import type { SpendLedger } from "../infrastructure/spend-ledger.js";
import type { CountDay } from "./count-day.js";

export interface Repricer {
  repriceAwaiting(provider: string): Promise<void>;
  backfill(provider: string): Promise<void>;
  repriceGuesses(provider: string): Promise<void>;
}

const BATCH = 500;
const DAY_MS = 86_400_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: prices again the call rows of a provider whose
 * model had no price when they were metered: the calls that waited for their
 * price, after each read that adds prices or, for a provider whose prices
 * come with a deploy, at each start; the estimates written before calls
 * recorded where their price came from, after each full read; and, at each
 * start, the guesses from a model family's highest prices that such a
 * provider wrote before guesses were removed. Each
 * batch moves the call rows and their rollup rows in one transaction, then
 * today's day counters and the calls' kept state by the same difference, so
 * a late record of the same call adds nothing twice. A row is re-priced only
 * while its price source is still the one that was read, so two replicas
 * never re-price one call twice; a call that had a real price never changes.
 */
export function createRepricer(deps: {
  ledger: SpendLedger;
  calls: CallStates;
  countDay: CountDay;
  priceBook: () => PriceBook;
  metrics: PriceMetrics;
  now?: () => Date;
}): Repricer {
  const log = () => getLogger();

  const run = async (provider: string, kind: RepriceKind) => {
    const now = deps.now?.() ?? new Date();
    const since = new Date(now.getTime() - CALL_ROWS_RETENTION_DAYS * DAY_MS);
    const today = utcDay(now);
    let after: { callingAgentId: string; callId: string } | null = null;
    for (;;) {
      const candidates = await deps.ledger.repriceCandidates({
        provider,
        kind,
        since,
        after,
        limit: BATCH,
      });
      const book = deps.priceBook();
      const changes = candidates.flatMap((candidate) => {
        const change = repriceCall(candidate, kind, book);
        return change ? [change] : [];
      });
      const repriced = await deps.ledger.reprice(changes);
      for (const call of repriced) {
        if (call.row.day === today && call.costDelta !== 0)
          await deps.countDay(call.row, call.costDelta);
        await deps.calls
          .reprice(call.callId, call.costMicros, call.estimated ? 1 : 0)
          .catch((err: unknown) =>
            log().warn(
              { callId: call.callId, reason: formatError(err) },
              "spend.call_state_not_repriced",
            ),
          );
      }
      if (repriced.length > 0) {
        deps.metrics.repriced({ provider, kind }, repriced.length);
        log().info(
          {
            provider,
            kind,
            calls: repriced.length,
            differenceMicros: repriced.reduce((sum, c) => sum + c.costDelta, 0),
          },
          "spend.repriced",
        );
      }
      const last = candidates.at(-1);
      if (!last || candidates.length < BATCH) return;
      after = { callingAgentId: last.callingAgentId, callId: last.callId };
    }
  };

  return {
    repriceAwaiting: (provider) => run(provider, "awaiting"),
    backfill: (provider) => run(provider, "backfill"),
    repriceGuesses: (provider) => run(provider, "guess"),
  };
}

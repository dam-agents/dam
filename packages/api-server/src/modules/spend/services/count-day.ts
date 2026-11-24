import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import { dayCountersOf, type SpendRow } from "../domain/ledger.js";
import type { DayCounters } from "../infrastructure/day-counters.js";
import type { SpendLedger } from "../infrastructure/spend-ledger.js";

export type CountDay = (row: SpendRow, deltaMicros: number) => Promise<void>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: moves every day counter of a rollup row by a
 * cost difference, after the rollup row itself moved. A counter that is
 * missing is rebuilt from the rollup, and a counter that fails to move is
 * dropped, so the next read rebuilds it rather than keep a wrong total.
 */
export function createCountDay(deps: {
  counters: DayCounters;
  ledger: Pick<SpendLedger, "total">;
}): CountDay {
  return async (row, deltaMicros) => {
    for (const counter of dayCountersOf(row)) {
      try {
        if (await deps.counters.addIfPresent(counter, deltaMicros)) continue;
        await deps.counters.setIfMissing(
          counter,
          await deps.ledger.total(counter),
        );
      } catch (err) {
        getLogger().warn(
          { counter, reason: formatError(err) },
          "spend.counter_write_failed",
        );
        await deps.counters.drop(counter).catch(() => {});
      }
    }
  };
}

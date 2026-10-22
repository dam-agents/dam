import { CALL_ROWS_RETENTION_DAYS, type SpendReadWindow } from "api-server-api";
import { utcDay, type CallWindow } from "./ledger.js";

const DAY_MS = 86_400_000;

export interface ReadRange {
  readonly from: string;
  readonly to: string;
  readonly at?: CallWindow;
  readonly window: SpendReadWindow;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an exact window reads the call rows while it
 * starts within their retention; one that starts earlier widens to the UTC
 * days it touches, which only the daily rollup holds. Nothing before the
 * measuring start counts either way.
 */
export function readRangeOf(
  asked: { fromAt: string; toAt: string },
  now: Date,
  measuredFrom: Date,
): ReadRange {
  const fromAt = new Date(
    Math.max(Date.parse(asked.fromAt), measuredFrom.getTime()),
  );
  const toAt = new Date(Math.max(Date.parse(asked.toAt), fromAt.getTime()));
  const from = utcDay(fromAt);
  const to = utcDay(new Date(Math.max(fromAt.getTime(), toAt.getTime() - 1)));
  if (fromAt.getTime() >= now.getTime() - CALL_ROWS_RETENTION_DAYS * DAY_MS) {
    return {
      from,
      to,
      at: { fromAt, toAt },
      window: {
        granularity: "hour",
        fromAt: fromAt.toISOString(),
        toAt: toAt.toISOString(),
      },
    };
  }
  return {
    from,
    to,
    window: {
      granularity: "day",
      fromAt: `${from}T00:00:00.000Z`,
      toAt: new Date(Date.parse(`${to}T00:00:00Z`) + DAY_MS).toISOString(),
    },
  };
}

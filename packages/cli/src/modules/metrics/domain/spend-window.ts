import {
  formatSpendAmount,
  SPEND_DAILY_MAX_DAYS,
  type SpendAmount,
  type SpendCallCost,
} from "api-server-api";

const DAY_MS = 86_400_000;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface DayWindow {
  from: string;
  to: string;
}

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the UTC days that a lookback of `sinceHours`
 * touches, from the measuring start at the earliest; with no lookback, every
 * measured day. One read spans at most the spend read's day limit.
 */
export function spendWindow(input: {
  sinceHours: number | undefined;
  startDay: string;
  now: Date;
}): DayWindow {
  const to = utcDay(input.now.getTime());
  const earliest = utcDay(
    input.now.getTime() - (SPEND_DAILY_MAX_DAYS - 1) * DAY_MS,
  );
  const asked =
    input.sinceHours === undefined
      ? input.startDay
      : utcDay(input.now.getTime() - input.sinceHours * 3_600_000);
  const from = [asked, input.startDay, earliest].reduce((a, b) =>
    a > b ? a : b,
  );
  return { from, to };
}

function parts(day: string): { d: number; m: string; y: string } {
  return {
    d: Number(day.slice(8, 10)),
    m: MONTHS[Number(day.slice(5, 7)) - 1] ?? "",
    y: day.slice(0, 4),
  };
}

export function formatDayWindow({ from, to }: DayWindow): string {
  const a = parts(from);
  const b = parts(to);
  if (from === to) return `${b.d} ${b.m} ${b.y}`;
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
  return `${a.d}–${b.d} ${b.m} ${b.y}`;
}

export function spendText(amounts: readonly SpendAmount[]): string {
  const shown = amounts.filter((a) => a.unit !== "free" && a.costMicros > 0);
  if (shown.length === 0) return formatSpendAmount(0, "usd");
  return shown.map((a) => formatSpendAmount(a.costMicros, a.unit)).join("; ");
}

export function callCostText(
  cost: Omit<SpendCallCost, "routerCallId"> | null,
): string {
  if (!cost) return "—";
  const text = formatSpendAmount(cost.costMicros, cost.unit);
  return cost.estimated ? `~${text}` : text;
}

export const NO_CALL_TELEMETRY =
  "Recent calls are not available: this deployment does not collect agent telemetry.";

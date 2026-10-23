import {
  formatSpendAmount,
  SPEND_DAILY_MAX_DAYS,
  type SpendAmount,
  type SpendCallCost,
  type SpendReadWindow,
} from "api-server-api";

interface SpendAtWindow {
  fromAt: string;
  toAt: string;
}

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
 * UNIT_BOUNDARY_DESCRIPTION: every measured UTC day, from the measuring start
 * at the earliest; one read spans at most the spend read's day limit.
 */
export function spendWindow(input: { startDay: string; now: Date }): DayWindow {
  const to = utcDay(input.now.getTime());
  const earliest = utcDay(
    input.now.getTime() - (SPEND_DAILY_MAX_DAYS - 1) * DAY_MS,
  );
  const from = input.startDay > earliest ? input.startDay : earliest;
  return { from, to };
}

export function hourWindow(sinceHours: number, now: Date): SpendAtWindow {
  return {
    fromAt: new Date(now.getTime() - sinceHours * 3_600_000).toISOString(),
    toAt: now.toISOString(),
  };
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

export function formatAt(iso: string): string {
  const day = parts(iso.slice(0, 10));
  return `${day.d} ${day.m} ${day.y} ${iso.slice(11, 16)}`;
}

export function readWindowLabel(
  read: SpendReadWindow,
  days: DayWindow,
  sinceHours: number,
): string {
  return read.granularity === "hour"
    ? `last ${sinceHours} h, ${formatAt(read.fromAt)} – ${formatAt(read.toAt)} UTC`
    : `${formatDayWindow(days)}, UTC days (whole days: hourly spend is kept for 30 days)`;
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

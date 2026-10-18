import { type UnitAmounts, VISIBLE_MICROS } from "./measured-spend.js";

export type RowAmount =
  | { kind: "paid"; paidMicros: number; planMicros: number | null }
  | { kind: "plan-only"; micros: number }
  | { kind: "bobcoin"; micros: number }
  | { kind: "no-cost" }
  | { kind: "not-priced" };

export interface RowSource {
  key: string;
  label: string;
  help?: string;
  amounts: UnitAmounts;
  freeCalls: number;
  notPriced: boolean;
}

export interface SpendRow {
  key: string;
  label: string;
  help?: string;
  amount: RowAmount;
  paidPct: number;
  planPct: number;
}

function amountOf(source: RowSource, showPlanUse: boolean): RowAmount | null {
  const { amounts } = source;
  const paid = amounts.usd >= VISIBLE_MICROS;
  const plan = amounts.usd_list >= VISIBLE_MICROS;
  if (paid) {
    return {
      kind: "paid",
      paidMicros: amounts.usd,
      planMicros: plan && showPlanUse ? amounts.usd_list : null,
    };
  }
  if (plan) return { kind: "plan-only", micros: amounts.usd_list };
  if (amounts.bobcoin > 0) return { kind: "bobcoin", micros: amounts.bobcoin };
  if (source.notPriced) return { kind: "not-priced" };
  if (source.freeCalls > 0) return { kind: "no-cost" };
  return null;
}

export function spendRows(
  sources: readonly RowSource[],
  showPlanUse: boolean,
): SpendRow[] {
  const size = ({ amounts }: RowSource) =>
    amounts.usd + (showPlanUse ? amounts.usd_list : 0);
  const shown = sources.flatMap((source) => {
    const amount = amountOf(source, showPlanUse);
    return amount ? [{ source, amount }] : [];
  });
  const top = Math.max(0, ...shown.map(({ source }) => size(source)));
  const pct = (micros: number) => (top > 0 ? (micros / top) * 100 : 0);
  return shown
    .sort(
      (a, b) =>
        size(b.source) - size(a.source) ||
        b.source.amounts.usd_list - a.source.amounts.usd_list ||
        b.source.amounts.bobcoin - a.source.amounts.bobcoin ||
        a.source.label.localeCompare(b.source.label),
    )
    .map(({ source, amount }) => ({
      key: source.key,
      label: source.label,
      ...(source.help && { help: source.help }),
      amount,
      paidPct: pct(source.amounts.usd),
      planPct: showPlanUse ? pct(source.amounts.usd_list) : 0,
    }));
}

import type { CreditSpend } from "api-server-api";

import { formatDurationMs } from "@/lib/format-time";

export { formatDurationMs };

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatTokens(count: number): string {
  return compactNumber.format(count);
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toPrecision(2)}`;
}

export function formatUsdCents(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function formatUsdCell(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function formatAxisUsd(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.01 ? 2 : 4;
  return `$${value.toFixed(decimals)}`;
}

const CREDIT_LABELS: Record<string, string> = { bobcoin: "Bobcoins" };

export const creditUnitLabel = (unit: string): string =>
  CREDIT_LABELS[unit] ?? unit;

export const formatAxisCount = (value: number): string =>
  compactNumber.format(value);

const exactCount = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function formatCredits(
  credits: CreditSpend[],
  amount: (n: number) => string = compactNumber.format.bind(compactNumber),
): string {
  return credits
    .map((c) => `${amount(c.amount)} ${creditUnitLabel(c.unit)}`)
    .join(" + ");
}

export const formatCreditsExact = (credits: CreditSpend[]): string =>
  formatCredits(credits, exactCount.format.bind(exactCount));

export function formatSpend(
  costUsd: number,
  credits: CreditSpend[],
  usd: (n: number) => string = formatUsd,
  creditText: (c: CreditSpend[]) => string = formatCredits,
): string {
  if (credits.length === 0) return usd(costUsd);
  const text = creditText(credits);
  return costUsd > 0 ? `${usd(costUsd)} + ${text}` : text;
}

export const formatSpendExact = (
  costUsd: number,
  credits: CreditSpend[],
): string => formatSpend(costUsd, credits, formatUsdCents, formatCreditsExact);

export interface SpendRow {
  costUsd: number;
  credits: CreditSpend[];
}

const USD_SCALE = Symbol("usd");
type ScaleKey = typeof USD_SCALE | string;

export function spendScale(row: SpendRow): {
  key: ScaleKey;
  amount: number;
  unit: string | null;
} {
  if (row.costUsd > 0 || row.credits.length === 0) {
    return { key: USD_SCALE, amount: row.costUsd, unit: null };
  }
  const largest = row.credits.reduce((a, b) => (b.amount > a.amount ? b : a));
  return { key: largest.unit, amount: largest.amount, unit: largest.unit };
}

export function spendBarPct(rows: readonly SpendRow[]): number[] {
  const max = new Map<ScaleKey, number>();
  for (const row of rows) {
    const { key, amount } = spendScale(row);
    max.set(key, Math.max(max.get(key) ?? 0, amount));
  }
  return rows.map((row) => {
    const { key, amount } = spendScale(row);
    const top = max.get(key) ?? 0;
    return top > 0 ? (amount / top) * 100 : 0;
  });
}

export function topPerUnit<T extends SpendRow>(
  rows: readonly T[],
  limit: number,
): T[] {
  const byUnit = new Map<ScaleKey, T[]>();
  for (const row of rows) {
    const { key } = spendScale(row);
    byUnit.set(key, [...(byUnit.get(key) ?? []), row]);
  }
  for (const group of byUnit.values()) {
    group.sort((a, b) => spendScale(b).amount - spendScale(a).amount);
  }
  const groups = [...byUnit.values()];
  const picked: T[] = [];
  for (let rank = 0; picked.length < limit; rank++) {
    const round = groups.flatMap((g) => (g[rank] ? [g[rank]] : []));
    if (round.length === 0) break;
    picked.push(...round.slice(0, limit - picked.length));
  }
  return picked;
}

export const spendBarScaleLabel = (row: SpendRow): string => {
  const { unit } = spendScale(row);
  return unit === null ? "dollars" : creditUnitLabel(unit);
};

export function durationSegments(
  ms: number,
): { text: string; unit: boolean }[] {
  return formatDurationMs(ms)
    .split(/(\d+(?:\.\d+)?)/)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, unit: !/^\d/.test(part) }));
}

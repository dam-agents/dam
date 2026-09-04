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

export function formatCredits(credits: CreditSpend[]): string {
  return credits
    .map((c) => `${compactNumber.format(c.amount)} ${creditUnitLabel(c.unit)}`)
    .join(" + ");
}

export function formatSpend(
  costUsd: number,
  credits: CreditSpend[],
  usd: (n: number) => string = formatUsd,
): string {
  if (credits.length === 0) return usd(costUsd);
  const creditText = formatCredits(credits);
  return costUsd > 0 ? `${usd(costUsd)} + ${creditText}` : creditText;
}

export function spendBarPct(
  rows: readonly { costUsd: number; credits: CreditSpend[] }[],
): number[] {
  const magnitude = (r: (typeof rows)[number]): [string, number] =>
    r.costUsd > 0 || r.credits.length === 0
      ? ["usd", r.costUsd]
      : [r.credits[0].unit, r.credits[0].amount];
  const max = new Map<string, number>();
  for (const row of rows) {
    const [unit, amount] = magnitude(row);
    max.set(unit, Math.max(max.get(unit) ?? 0, amount));
  }
  return rows.map((row) => {
    const [unit, amount] = magnitude(row);
    const top = max.get(unit) ?? 0;
    return top > 0 ? (amount / top) * 100 : 0;
  });
}

export function durationSegments(
  ms: number,
): { text: string; unit: boolean }[] {
  return formatDurationMs(ms)
    .split(/(\d+(?:\.\d+)?)/)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, unit: !/^\d/.test(part) }));
}

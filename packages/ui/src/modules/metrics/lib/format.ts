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

export function durationSegments(
  ms: number,
): { text: string; unit: boolean }[] {
  return formatDurationMs(ms)
    .split(/(\d+(?:\.\d+)?)/)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, unit: !/^\d/.test(part) }));
}

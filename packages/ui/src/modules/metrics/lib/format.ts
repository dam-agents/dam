const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatTokens(count: number): string {
  return compactNumber.format(count);
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  // Per-call costs are often sub-cent; keep two significant digits there.
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toPrecision(2)}`;
}

/** Headline / total figure: always two decimals so it never reads as a bare
 *  "$0" next to precise amounts like "$902.03". */
export function formatUsdCents(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Table-cell cost: two decimals, but collapse any sub-cent value to "<$0.01"
 *  so a stray "$0.00058" doesn't wreck the mono column's glyph alignment. The
 *  caller keeps the exact number in a `title`. */
export function formatUsdCell(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** Axis tick label with a fixed decimal count derived from the tick step, so a
 *  column of ticks shares glyph widths ($0.00 / $0.05 / $0.10 rather than a
 *  ragged $0 / $0.05 / $0.0025). */
export function formatAxisUsd(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.01 ? 2 : 4;
  return `$${value.toFixed(decimals)}`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

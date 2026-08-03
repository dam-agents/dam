const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Coarse relative time for table cells: "in 12m" / "3h ago". */
export function formatRelative(iso: string, now: Date): string {
  const diffMs = Date.parse(iso) - now.getTime();
  const abs = Math.abs(diffMs);
  const value =
    abs >= DAY_MS
      ? `${Math.floor(abs / DAY_MS)}d`
      : abs >= HOUR_MS
        ? `${Math.floor(abs / HOUR_MS)}h`
        : `${Math.max(1, Math.floor(abs / MINUTE_MS))}m`;
  return diffMs >= 0 ? `in ${value}` : `${value} ago`;
}

type DateInput = string | number | Date | null | undefined;

/** null for an unparseable or absent value, so the formatters fail soft to "—"
 *  rather than render "Invalid Date" — or the 1970 epoch, which is what
 *  `new Date(null)` yields. Nullable timestamps are common in the API types,
 *  and this is the single funnel for every date. */
function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const UNITS: Array<[label: string, ms: number]> = [
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
];

/** The largest whole unit of a duration as a glued abbreviation — "3d", "2h",
 *  "5m" — or "moments" below a minute. */
export function largestUnit(ms: number): string {
  for (const [label, unitMs] of UNITS) {
    if (ms >= unitMs) return `${Math.floor(ms / unitMs)}${label}`;
  }
  return "moments";
}

/** Wall-clock elapsed time at two-unit precision — "42s", "4m 12s", "1h 5m",
 *  "2d 5h"; "—" for a negative or non-finite input. Distinct from the metrics
 *  module's `formatDurationMs`, which measures summed API latency and so tops
 *  out at hours and keeps sub-second precision. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Past-facing relative time: "just now", "5m ago", "2h ago", "3d ago";
 *  "—" for an unparseable date. */
export function timeAgo(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  const delta = Date.now() - d.getTime();
  if (delta < 60_000) return "just now";
  return `${largestUnit(delta)} ago`;
}

/** Future-facing relative time for a next-run glance: "due", "< 1 min",
 *  "in 3 min", "in 2 h", "in 5 d"; "—" for an unparseable date. The absolute
 *  time stays on hover/title. */
export function timeUntil(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "—";
  const diff = d.getTime() - now.getTime();
  if (diff <= 0) return "due";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `in ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr} h`;
  const days = Math.round(hr / 24);
  return `in ${days} d`;
}

/** The standard compact date + time — locale-aware like the rest of the module
 *  (24-hour, numeric); "—" for an unparseable date. Reach for this on dense
 *  timestamp lines (session/run rows); use `formatDate` or `formatDateTime`
 *  when you need a different field set. */
export function formatTimestamp(value: DateInput): string {
  return formatDateTime(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** `toLocaleDateString` without an inline `new Date(...)`; options pass
 *  through, "—" for an unparseable/absent value. */
export function formatDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return toDate(value)?.toLocaleDateString(undefined, options) ?? "—";
}

/** `toLocaleString` (date + time), same guarantees as `formatDate`. */
export function formatDateTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return toDate(value)?.toLocaleString(undefined, options) ?? "—";
}

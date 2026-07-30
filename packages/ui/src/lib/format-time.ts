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

/** Past-facing relative time: "just now", "5m ago", "2h ago", "3d ago". */
export function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return "just now";
  return `${largestUnit(delta)} ago`;
}

/** Future-facing relative time for a next-run glance: "due", "< 1 min",
 *  "in 3 min", "in 2 h", "in 5 d". The absolute time stays on hover/title. */
export function timeUntil(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  if (diff <= 0) return "due";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `in ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr} h`;
  const d = Math.round(hr / 24);
  return `in ${d} d`;
}

/** Absolute, zero-padded MM/DD/YYYY HH:MM in local time; "—" for an invalid
 *  date. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type DateInput = string | number | Date;

/** null for an unparseable value, so the wrappers can fail soft to "—" rather
 *  than render "Invalid Date" — they're now the single funnel for every date. */
function toDate(value: DateInput): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `toLocaleDateString` without an inline `new Date(...)`; options pass through. */
export function formatDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return toDate(value)?.toLocaleDateString(undefined, options) ?? "—";
}

/** `toLocaleString` (date + time) without an inline `new Date(...)`. */
export function formatDateTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return toDate(value)?.toLocaleString(undefined, options) ?? "—";
}

/** `toLocaleTimeString` without an inline `new Date(...)`. */
export function formatTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return toDate(value)?.toLocaleTimeString(undefined, options) ?? "—";
}

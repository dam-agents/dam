type DateInput = string | number | Date | null | undefined;

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

export function largestUnit(ms: number): string {
  for (const [label, unitMs] of UNITS) {
    if (ms >= unitMs) return `${Math.floor(ms / unitMs)}${label}`;
  }
  return "moments";
}

export function timeAgo(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "—";
  const delta = now.getTime() - d.getTime();
  if (delta < 60_000) return "just now";
  return `${largestUnit(delta)} ago`;
}

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

export function formatDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return toDate(value)?.toLocaleDateString(undefined, options) ?? "—";
}

export function formatDateTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return toDate(value)?.toLocaleString(undefined, options) ?? "—";
}

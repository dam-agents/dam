export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const UNITS: Array<[label: string, ms: number]> = [
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
];

function largestUnit(ms: number): string {
  for (const [label, unitMs] of UNITS) {
    if (ms >= unitMs) return `${Math.floor(ms / unitMs)}${label}`;
  }
  return "moments";
}

export function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return "just now";
  return `${largestUnit(delta)} ago`;
}

export type ExpiryState =
  | { state: "never" }
  | { state: "active"; label: string; soon: boolean }
  | { state: "expired"; label: string };

export function expiryState(expiresAt: string | null): ExpiryState {
  if (!expiresAt) return { state: "never" };
  const delta = new Date(expiresAt).getTime() - Date.now();
  if (delta <= 0)
    return { state: "expired", label: `expired ${largestUnit(-delta)} ago` };
  return {
    state: "active",
    label: `expires in ${largestUnit(delta)}`,
    soon: delta < 24 * 3_600_000,
  };
}

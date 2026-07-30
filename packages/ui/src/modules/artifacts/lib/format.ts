import { largestUnit } from "@/lib/format-time";

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

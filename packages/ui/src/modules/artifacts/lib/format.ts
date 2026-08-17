import { largestUnit } from "@/lib/format-time";

export const RESTORE_WINDOW_DAYS = 7;

const RESTORE_WINDOW_MS = RESTORE_WINDOW_DAYS * 86_400_000;

export type DeletionState =
  | { state: "never" }
  | { state: "active"; label: string; soon: boolean }
  | { state: "expired"; label: string };

export function deletionState(expiresAt: string | null): DeletionState {
  if (!expiresAt) return { state: "never" };
  const delta = new Date(expiresAt).getTime() - Date.now();
  if (delta <= 0) {
    const restoreLeft = RESTORE_WINDOW_MS + delta;
    return {
      state: "expired",
      label:
        restoreLeft > 0
          ? `deletion pending · ${largestUnit(restoreLeft)} to restore`
          : "deletion pending",
    };
  }
  return {
    state: "active",
    label: `deletes in ${largestUnit(delta)}`,
    soon: delta < 24 * 3_600_000,
  };
}

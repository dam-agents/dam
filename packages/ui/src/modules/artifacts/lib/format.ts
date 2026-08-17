import { largestUnit } from "@/lib/format-time";

export const RESTORE_WINDOW_DAYS = 7;

const RESTORE_WINDOW_MS = RESTORE_WINDOW_DAYS * 86_400_000;

export type DeletionState =
  | { state: "never" }
  | { state: "active"; label: string; soon: boolean }
  | { state: "expired"; label: string; restoreLeft: string | null };

export function deletionState(expiresAt: string | null): DeletionState {
  if (!expiresAt) return { state: "never" };
  const delta = new Date(expiresAt).getTime() - Date.now();
  if (delta <= 0) {
    const left = RESTORE_WINDOW_MS + delta;
    const restoreLeft = left > 0 ? largestUnit(left) : null;
    return {
      state: "expired",
      label: restoreLeft
        ? `deletion pending · ${restoreLeft} to restore`
        : "deletion pending",
      restoreLeft,
    };
  }
  return {
    state: "active",
    label: `deletes in ${largestUnit(delta)}`,
    soon: delta < 24 * 3_600_000,
  };
}

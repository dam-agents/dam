import { ARTIFACT_RESTORE_WINDOW_DAYS } from "api-server-api";

import { formatDate, largestUnit, timeUntil } from "@/lib/format-time";

const RESTORE_WINDOW_MS = ARTIFACT_RESTORE_WINDOW_DAYS * 86_400_000;

const DELETION_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

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

export function deletionDate(expiresAt: string | null): string {
  return formatDate(expiresAt, DELETION_DATE_FORMAT);
}

export function deletionSummary(expiresAt: string | null): string {
  const deletion = deletionState(expiresAt);
  if (deletion.state === "never")
    return "This artifact is kept until you delete it.";
  const date = deletionDate(expiresAt);
  if (deletion.state === "active")
    return `Currently deletes on ${date} — ${timeUntil(expiresAt)}.`;
  return deletion.restoreLeft
    ? `Deletion is pending since ${date} — ${deletion.restoreLeft} left to restore it.`
    : `Deletion is pending since ${date}.`;
}

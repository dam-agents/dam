import type { ProfileWithUsage } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a new channel or schedule starts on (D91,
 * D92): the profile the newest sibling of the same agent runs on, else the
 * agent's chat profile, else the owner's seeded Default. A reference the owner
 * no longer holds is skipped rather than preselected, so a form never opens on
 * something it cannot save.
 */
export function defaultProfileId({
  profiles,
  newestProfileId,
  chatProfileId,
}: {
  profiles: readonly ProfileWithUsage[];
  newestProfileId: string | null;
  chatProfileId: string | null;
}): string | null {
  const owned = (id: string | null) =>
    id !== null && profiles.some((p) => p.id === id) ? id : null;
  return (
    owned(newestProfileId) ??
    owned(chatProfileId) ??
    profiles.find((p) => p.seeded)?.id ??
    null
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile the newest of the agent's channels or
 * schedules names, from rows ordered newest first; a row without one is passed
 * over, since a legacy row says nothing about what a new one should run on.
 */
export function newestProfileId(
  rowsNewestFirst: readonly { profileId?: string | null }[],
): string | null {
  return rowsNewestFirst.find((row) => row.profileId)?.profileId ?? null;
}

/** UNIT_BOUNDARY_DESCRIPTION: channel rows as the bind dialog reads them — newest first, since their list arrives in no particular order. */
export function newestFirst<T extends { createdAt?: string }>(
  rows: readonly T[],
): T[] {
  const at = (row: T) => (row.createdAt ? +new Date(row.createdAt) : 0);
  return [...rows].sort((a, b) => at(b) - at(a));
}

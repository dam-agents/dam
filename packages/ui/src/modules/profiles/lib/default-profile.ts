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

/** UNIT_BOUNDARY_DESCRIPTION: the profile the newest of the agent's channels or schedules names; a row without one is passed over, since a legacy row says nothing about what a new one should run on. */
export function newestProfileId(
  rows: readonly {
    profileId?: string | null;
    createdAt?: Date | string;
  }[],
): string | null {
  const at = (row: { createdAt?: Date | string }) =>
    row.createdAt ? +new Date(row.createdAt) : 0;
  return (
    [...rows].sort((a, b) => at(b) - at(a)).find((row) => row.profileId)
      ?.profileId ?? null
  );
}

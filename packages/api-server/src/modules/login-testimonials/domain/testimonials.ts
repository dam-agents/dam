// UNIT_BOUNDARY_DESCRIPTION: the rule a saved list of login testimonials keeps beyond its field limits: every photo it names is an image that is stored. It returns the first photo id that is not, so the save is refused with that id, rather than leaving a broken image on the login page.
export function firstMissingPhoto(
  photoIds: readonly (string | null)[],
  stored: ReadonlySet<string>,
): string | null {
  return photoIds.find((id) => id !== null && !stored.has(id)) ?? null;
}

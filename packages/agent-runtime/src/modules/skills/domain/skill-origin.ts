import type { SkillOrigin } from "agent-runtime-api";

/**
 * Provenance rule (#2828): a Local Skill with no pristine image counterpart
 * (`pristineHash === null`) was created at runtime — `user`. With one, the
 * content hash separates untouched (`system`) from diverged
 * (`system-modified`). Pure; acquiring the hashes is infrastructure's job,
 * and `localHash` may be null only when there is no counterpart to compare
 * against (the caller skips hashing it then).
 */
export function judgeOrigin(
  localHash: string | null,
  pristineHash: string | null,
): SkillOrigin {
  if (pristineHash === null) return "user";
  return localHash === pristineHash ? "system" : "system-modified";
}

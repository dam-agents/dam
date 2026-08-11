import type { Skill, SkillRef } from "api-server-api";

/**
 * Installed content differs from what the source now serves. One definition,
 * shared by the row's Update pill and the page-level drift banner — two
 * predicates would eventually disagree and the banner would name a skill whose
 * row shows nothing to update.
 *
 * `contentHash` is absent only on skills installed before it was recorded;
 * those can't be compared, so they don't count as drifted until the next
 * install fills it in.
 */
export function isDrifted(ref: SkillRef | undefined, scanned: Skill): boolean {
  return (
    ref?.contentHash !== undefined && ref.contentHash !== scanned.contentHash
  );
}

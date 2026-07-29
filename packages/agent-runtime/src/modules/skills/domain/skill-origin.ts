import type { SkillOrigin } from "agent-runtime-api";

/** Provenance rule (#2828): no pristine counterpart → user; otherwise the
 *  content hash separates untouched from diverged. A null `localHash` means
 *  the local copy couldn't be hashed (unreadable, or deleted mid-listing) —
 *  that degrades to diverged rather than failing the listing. */
export function judgeOrigin(
  localHash: string | null,
  pristineHash: string | null,
): SkillOrigin {
  if (pristineHash === null) return "user";
  return localHash === pristineHash ? "system" : "system-modified";
}

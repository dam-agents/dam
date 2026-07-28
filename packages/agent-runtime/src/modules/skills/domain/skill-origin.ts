import type { SkillOrigin } from "agent-runtime-api";

/** Provenance rule (#2828): no pristine counterpart → user; otherwise the
 *  content hash separates untouched from diverged. `localHash` may be null
 *  only when `pristineHash` is null. */
export function judgeOrigin(
  localHash: string | null,
  pristineHash: string | null,
): SkillOrigin {
  if (pristineHash === null) return "user";
  return localHash === pristineHash ? "system" : "system-modified";
}

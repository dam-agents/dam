import type { Skill, SkillRef } from "api-server-api";

export type SkillStatus = "not-installed" | "installed" | "update-available";
export type AnnotatedSkill = Skill & { status: SkillStatus };

/**
 * Annotate a scanned skill against an agent's installed refs. Join key is
 * (source gitUrl, name) — a scanned `Skill.source` and an installed
 * `SkillRef.source` are both the gitUrl. Drift skips refs whose `contentHash`
 * is undefined (installs predating the field).
 */
export function statusFor(
  scanned: Skill,
  installed: readonly SkillRef[],
): SkillStatus {
  const ref = installed.find(
    (r) => r.source === scanned.source && r.name === scanned.name,
  );
  if (!ref) return "not-installed";
  if (ref.contentHash !== undefined && ref.contentHash !== scanned.contentHash)
    return "update-available";
  return "installed";
}

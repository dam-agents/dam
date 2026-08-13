import type { Skill, SkillRef } from "api-server-api";

export function isDrifted(ref: SkillRef | undefined, scanned: Skill): boolean {
  return (
    ref?.contentHash !== undefined && ref.contentHash !== scanned.contentHash
  );
}

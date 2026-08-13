import type { SkillOrigin } from "agent-runtime-api";

export function judgeOrigin(
  localHash: string | null,
  pristineHash: string | null,
): SkillOrigin {
  if (pristineHash === null) return "user";
  return localHash === pristineHash ? "system" : "system-modified";
}

import type { LocalSkill } from "./types.js";

export type PlatformFeatureId = "schedules" | "invocations" | "connections";

export interface PlatformSkillFeature {
  id: PlatformFeatureId;
  label: string;
}

export const PLATFORM_SKILLS: ReadonlyMap<string, PlatformSkillFeature> =
  new Map([
    ["platform-schedules", { id: "schedules", label: "Schedules" }],
    ["dam-invoke", { id: "invocations", label: "Invocations" }],
    ["platform-models", { id: "connections", label: "Model providers" }],
  ] satisfies [string, PlatformSkillFeature][]);

export function platformSkillFeature(
  skill: Pick<LocalSkill, "name" | "origin">,
): PlatformSkillFeature | undefined {
  if (skill.origin !== "system" && skill.origin !== "system-modified") {
    return undefined;
  }
  return PLATFORM_SKILLS.get(skill.name);
}

export function platformSkillsForFeature(id: PlatformFeatureId): string[] {
  return [...PLATFORM_SKILLS]
    .filter(([, feature]) => feature.id === id)
    .map(([name]) => name);
}

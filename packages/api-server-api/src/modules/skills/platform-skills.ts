import { EXPERIMENT_SKILL_NAME } from "../experiments/schemas.js";
import type { LocalSkill } from "./types.js";

export const PLATFORM_FEATURE_IDS = [
  "schedules",
  "invocations",
  "experiments",
  "connections",
] as const;

export type PlatformFeatureId = (typeof PLATFORM_FEATURE_IDS)[number];

export interface PlatformSkillFeature {
  id: PlatformFeatureId;
  label: string;
}

export const PLATFORM_SKILLS: Readonly<Record<string, PlatformSkillFeature>> = {
  "platform-schedules": { id: "schedules", label: "Schedules" },
  "dam-invoke": { id: "invocations", label: "Invocations" },
  [EXPERIMENT_SKILL_NAME]: { id: "experiments", label: "Experiments" },
  "platform-models": { id: "connections", label: "Model providers" },
};

export function platformSkillFeature(
  skill: Pick<LocalSkill, "name" | "origin">,
): PlatformSkillFeature | undefined {
  if (skill.origin !== "system" && skill.origin !== "system-modified") {
    return undefined;
  }
  return PLATFORM_SKILLS[skill.name];
}

export function platformSkillsForFeature(id: PlatformFeatureId): string[] {
  return Object.entries(PLATFORM_SKILLS)
    .filter(([, feature]) => feature.id === id)
    .map(([name]) => name);
}

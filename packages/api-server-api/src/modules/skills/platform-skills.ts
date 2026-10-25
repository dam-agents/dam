import type { LocalSkill } from "./types.js";

export type PlatformFeatureId =
  "schedules" | "invocations" | "connections" | "chat-forms";

export interface PlatformSkillFeature {
  id: PlatformFeatureId;
  label: string;
}

export const PLATFORM_SKILLS: ReadonlyMap<string, PlatformSkillFeature> =
  new Map([
    ["platform-schedules", { id: "schedules", label: "Schedules" }],
    ["spawn-subagent", { id: "invocations", label: "Sub-agents" }],
    ["platform-models", { id: "connections", label: "Model providers" }],
    ["platform-github", { id: "connections", label: "GitHub accounts" }],
    ["platform-s3", { id: "connections", label: "Object Storage" }],
    ["platform-chat-forms", { id: "chat-forms", label: "Chat forms" }],
  ] satisfies [string, PlatformSkillFeature][]);

export function platformSkillFeature(
  skill: Pick<LocalSkill, "name" | "origin">,
): PlatformSkillFeature | undefined {
  if (skill.origin !== "system" && skill.origin !== "system-modified") {
    return undefined;
  }
  return PLATFORM_SKILLS.get(skill.name);
}

import type { z } from "zod";
import type { Agent } from "../agents/types.js";
import type { SkillSetApplyResult } from "../skills/types.js";
import type {
  starterKitApplyInputSchema,
  resolvedSkillSchema,
  starterKitCatalogEntrySchema,
  starterKitConnectionRequirementSchema,
  onboardingStepSchema,
  starterKitResourcesSchema,
  starterKitScheduleOverrideSchema,
  starterKitScheduleSchema,
  starterKitSchema,
} from "./schemas.js";

export type StarterKitConnectionRequirement = z.infer<
  typeof starterKitConnectionRequirementSchema
>;
export type ResolvedSkill = z.infer<typeof resolvedSkillSchema>;
export type StarterKitSchedule = z.infer<typeof starterKitScheduleSchema>;
export type StarterKitScheduleOverride = z.infer<
  typeof starterKitScheduleOverrideSchema
>;
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;
export type StarterKitResources = z.infer<typeof starterKitResourcesSchema>;
export type StarterKit = z.infer<typeof starterKitSchema>;

export type ResolvedStarterKit = Omit<StarterKit, "seed"> & {
  seed?: NonNullable<StarterKit["seed"]> & { url: string };
};
export type StarterKitCatalogEntry = z.infer<
  typeof starterKitCatalogEntrySchema
>;
export type StarterKitApplyInput = z.infer<typeof starterKitApplyInputSchema>;

export interface StarterKitView extends ResolvedStarterKit {
  catalog: string;
  version: string;
  source: string;
  skillsInKit: ResolvedSkill[];
}

export interface StarterKitApplyResult {
  agent: Agent;
  skills: SkillSetApplyResult | null;
  skillsError: string | null;
}

export interface StarterKitsService {
  list: () => Promise<StarterKitView[]>;
  get: (catalog: string, id: string) => Promise<StarterKitView | null>;
  apply: (input: StarterKitApplyInput) => Promise<StarterKitApplyResult>;
  markOnboarded: (agentId: string) => Promise<void>;
}

export function requirementAccepts(
  requirement: { accepts: readonly string[] },
  templateId: string,
  familyId?: string,
): boolean {
  return (
    requirement.accepts.includes(templateId) ||
    (familyId !== undefined && requirement.accepts.includes(familyId))
  );
}

export function resolveKitSchedulePrecheck(
  declared: string | undefined,
  override: string | null | undefined,
): string | undefined {
  if (override === null) return undefined;
  return override ?? declared;
}

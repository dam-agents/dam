import type { z } from "zod";
import type { Agent } from "../agents/types.js";
import type { SkillSetApplyResult } from "../skills/types.js";
import type {
  starterKitApplyInputSchema,
  resolvedSkillSchema,
  starterKitBundledSkillsSchema,
  starterKitCatalogEntrySchema,
  starterKitCatalogSchema,
  starterKitCategorySchema,
  starterKitConnectionRequirementSchema,
  starterKitImageSchema,
  starterKitParameterSchema,
  starterKitResourcesSchema,
  starterKitScheduleOverrideSchema,
  starterKitScheduleTimingSchema,
  starterKitScheduleSchema,
  starterKitSchema,
} from "./schemas.js";

export type StarterKitCategory = z.infer<typeof starterKitCategorySchema>;
export type StarterKitConnectionRequirement = z.infer<
  typeof starterKitConnectionRequirementSchema
>;
export type StarterKitBundledSkills = z.infer<
  typeof starterKitBundledSkillsSchema
>;
export type ResolvedSkill = z.infer<typeof resolvedSkillSchema>;
export type StarterKitSchedule = z.infer<typeof starterKitScheduleSchema>;
export type StarterKitScheduleOverride = z.infer<
  typeof starterKitScheduleOverrideSchema
>;
export type StarterKitScheduleTiming = z.infer<
  typeof starterKitScheduleTimingSchema
>;
export type StarterKitImage = z.infer<typeof starterKitImageSchema>;
export type StarterKitParameter = z.infer<typeof starterKitParameterSchema>;
export type StarterKitResources = z.infer<typeof starterKitResourcesSchema>;
export type StarterKit = z.infer<typeof starterKitSchema>;
export type StarterKitCatalogEntry = z.infer<
  typeof starterKitCatalogEntrySchema
>;
export type StarterKitCatalog = z.infer<typeof starterKitCatalogSchema>;
export type StarterKitApplyInput = z.infer<typeof starterKitApplyInputSchema>;

export interface StarterKitView extends StarterKit {
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

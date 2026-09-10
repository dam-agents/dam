import type { z } from "zod";
import type { Agent } from "../agents/types.js";
import type { SkillSetApplyResult } from "../skills/types.js";
import type {
  starterKitApplyInputSchema,
  starterKitCatalogEntrySchema,
  starterKitCatalogSchema,
  starterKitCategorySchema,
  starterKitConnectionRequirementSchema,
  starterKitParameterSchema,
  starterKitScheduleSchema,
  starterKitSchema,
} from "./schemas.js";

export type StarterKitCategory = z.infer<typeof starterKitCategorySchema>;
export type StarterKitConnectionRequirement = z.infer<
  typeof starterKitConnectionRequirementSchema
>;
export type StarterKitSchedule = z.infer<typeof starterKitScheduleSchema>;
export type StarterKitParameter = z.infer<typeof starterKitParameterSchema>;
export type StarterKit = z.infer<typeof starterKitSchema>;
export type StarterKitCatalogEntry = z.infer<
  typeof starterKitCatalogEntrySchema
>;
export type StarterKitCatalog = z.infer<typeof starterKitCatalogSchema>;
export type StarterKitApplyInput = z.infer<typeof starterKitApplyInputSchema>;

export interface StarterKitView extends StarterKit {
  version: string;
  source: string;
}

export interface StarterKitApplyResult {
  agent: Agent;
  skills: SkillSetApplyResult | null;
  skillsError: string | null;
}

export interface StarterKitsService {
  list: () => Promise<StarterKitView[]>;
  get: (id: string) => Promise<StarterKitView | null>;
  apply: (input: StarterKitApplyInput) => Promise<StarterKitApplyResult>;
  onboardingPrompt: (agentId: string) => Promise<string | null>;
}

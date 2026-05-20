import { z } from "zod";

export const ruleVerdictSchema = z.enum(["allow", "deny"]);

export const egressPresetSchema = z.enum(["none", "trusted", "all"]);

export const createEgressRuleInputSchema = z.object({
  agentId: z.string().min(1),
  host: z.string().min(1),
  method: z.string().min(1),
  pathPattern: z.string().min(1),
  verdict: ruleVerdictSchema,
});

export type CreateEgressRuleInput = z.infer<typeof createEgressRuleInputSchema>;

export const updateEgressRuleInputSchema = z.object({
  id: z.string().min(1),
  method: z.string().min(1),
  pathPattern: z.string().min(1),
  verdict: ruleVerdictSchema,
});

export type UpdateEgressRuleInput = z.infer<typeof updateEgressRuleInputSchema>;

export const applyEgressPresetInputSchema = z.object({
  agentId: z.string().min(1),
  preset: egressPresetSchema,
});

export type ApplyEgressPresetInput = z.infer<
  typeof applyEgressPresetInputSchema
>;

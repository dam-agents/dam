import { z } from "zod";

export const webSearchVerdictSchema = z.enum(["allow", "deny"]);

export const webSearchStateInputSchema = z.object({
  agentId: z.string().min(1),
});

export const webSearchSetRuleInputSchema = z.object({
  agentId: z.string().min(1),
  verdict: webSearchVerdictSchema.nullable(),
});

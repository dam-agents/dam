import { z } from "zod";

export const experimentConfigSchema = z.record(z.string(), z.unknown());

export const experimentIdInputSchema = z.object({
  id: z.string().min(1),
});

export const experimentCreateInputSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  prompt: z.string().trim().min(1, "prompt is required"),
});

export const experimentAddArmInputSchema = z.object({
  experimentId: z.string().min(1),
  agentId: z.string().min(1),
  armSpec: experimentConfigSchema.default({}),
});

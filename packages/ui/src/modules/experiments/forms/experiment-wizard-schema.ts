import { z } from "zod";

export const armFieldSchema = z.object({
  agentId: z.string().min(1, "Pick an agent"),
  variation: z.string(),
});

export const experimentWizardSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  prompt: z.string().trim().min(1, "Prompt is required"),
  arms: z.array(armFieldSchema).min(1, "Add at least one arm"),
});

export type ExperimentWizardValues = z.infer<typeof experimentWizardSchema>;

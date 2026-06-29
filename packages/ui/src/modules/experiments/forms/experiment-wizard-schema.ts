import { z } from "zod";

import type { ExperimentConfig } from "../types.js";

export const armFieldSchema = z.object({
  agentId: z.string().min(1, "Pick an agent"),
  /** Opaque per-arm JSON config, edited as text. Empty means `{}`. Validated to
   *  be a JSON object by the schema-level refinement below. */
  configText: z.string(),
});

export const experimentWizardSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    prompt: z.string().trim().min(1, "Prompt is required"),
    arms: z.array(armFieldSchema).min(1, "Add at least one arm"),
  })
  .superRefine((values, ctx) => {
    values.arms.forEach((arm, index) => {
      if (arm.configText.trim() === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(arm.configText);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Invalid JSON",
          path: ["arms", index, "configText"],
        });
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Config must be a JSON object",
          path: ["arms", index, "configText"],
        });
      }
    });
  });

export type ExperimentWizardValues = z.infer<typeof experimentWizardSchema>;

export function parseArmSpec(configText: string): ExperimentConfig {
  if (configText.trim() === "") return {};
  return JSON.parse(configText) as ExperimentConfig;
}

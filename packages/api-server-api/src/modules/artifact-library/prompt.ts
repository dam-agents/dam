import { z } from "zod";

export const ARTIFACT_PROMPT_TYPE = "artifact.prompt";
export const ARTIFACT_PROMPT_MAX_LENGTH = 16_384;

export const artifactPromptSchema = z.object({
  type: z.literal(ARTIFACT_PROMPT_TYPE),
  prompt: z.string().trim().min(1).max(ARTIFACT_PROMPT_MAX_LENGTH),
});

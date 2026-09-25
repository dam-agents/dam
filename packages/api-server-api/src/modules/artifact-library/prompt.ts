import { artifactApiRequestInputSchema } from "agent-runtime-api";
import { z } from "zod";

import type { ArtifactCallAgentApiResult } from "./types.js";

export const ARTIFACT_PROMPT_TYPE = "artifact.prompt";
export const ARTIFACT_PROMPT_MAX_LENGTH = 16_384;

export const artifactPromptSchema = z.object({
  type: z.literal(ARTIFACT_PROMPT_TYPE),
  prompt: z.string().trim().min(1).max(ARTIFACT_PROMPT_MAX_LENGTH),
});

export const ARTIFACT_REQUEST_TYPE = "artifact.request";
export const ARTIFACT_RESPONSE_TYPE = "artifact.response";
export const ARTIFACT_REQUEST_MAX_IN_FLIGHT = 8;
export const ARTIFACT_REQUEST_TIMEOUT_MS = 180_000;

export const artifactRequestEnvelopeSchema = z.object({
  type: z.literal(ARTIFACT_REQUEST_TYPE),
  id: z.string().min(1).max(64),
});

export const artifactRequestMessageSchema =
  artifactApiRequestInputSchema.extend(artifactRequestEnvelopeSchema.shape);

export type ArtifactRequestMessage = z.infer<
  typeof artifactRequestMessageSchema
>;

export type ArtifactResponseMessage = {
  type: typeof ARTIFACT_RESPONSE_TYPE;
  id: string;
} & ArtifactCallAgentApiResult;

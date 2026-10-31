import {
  artifactApiRequestInputSchema,
  type ArtifactApiCaller,
} from "agent-runtime-api";
import { z } from "zod";

import type { ArtifactCallAgentApiResult } from "./types.js";

export const ARTIFACT_PROMPT_TYPE = "artifact.prompt";
export const ARTIFACT_PROMPT_MAX_LENGTH = 16_384;

export const artifactPromptSchema = z.object({
  type: z.literal(ARTIFACT_PROMPT_TYPE),
  prompt: z.string().trim().min(1).max(ARTIFACT_PROMPT_MAX_LENGTH),
  newSession: z.boolean().optional(),
});

export type ArtifactPrompt = z.infer<typeof artifactPromptSchema>;

export const ARTIFACT_REQUEST_TYPE = "artifact.request";
export const ARTIFACT_RESPONSE_TYPE = "artifact.response";
export const ARTIFACT_REQUEST_MAX_IN_FLIGHT = 8;
export const ARTIFACT_REQUEST_TIMEOUT_MS = 180_000;

export const artifactRequestEnvelopeSchema = z.object({
  type: z.literal(ARTIFACT_REQUEST_TYPE),
  id: z.string().min(1).max(64),
});

export const artifactRequestMessageSchema =
  artifactApiRequestInputSchema.safeExtend(artifactRequestEnvelopeSchema.shape);

export type ArtifactResponseMessage = {
  type: typeof ARTIFACT_RESPONSE_TYPE;
  id: string;
} & ArtifactCallAgentApiResult;

export const ARTIFACT_WHOAMI_TYPE = "artifact.whoami";

export const artifactWhoamiMessageSchema = z.object({
  type: z.literal(ARTIFACT_WHOAMI_TYPE),
  id: z.string().min(1).max(64),
});

export type ArtifactWhoamiResponseMessage = {
  type: typeof ARTIFACT_RESPONSE_TYPE;
  id: string;
  ok: true;
} & ArtifactApiCaller;

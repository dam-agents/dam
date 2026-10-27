import { z } from "zod";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the wire shapes a harness can speak to a
 * provider: the Messages API, the Chat Completions API and the Responses API.
 * A harness runs a provider through the Model Router only when the provider
 * serves one of the dialects the harness's manifest lists.
 */
export const modelDialect = z.enum([
  "anthropic-messages",
  "openai-chat",
  "openai-responses",
]);
export type ModelDialect = z.infer<typeof modelDialect>;

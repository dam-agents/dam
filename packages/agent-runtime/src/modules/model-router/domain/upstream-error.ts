import type { ModelDialect } from "../../model-catalog/index.js";

const API_NAME: Record<ModelDialect, string> = {
  "anthropic-messages": "Anthropic Messages API",
  "openai-chat": "OpenAI Chat Completions API",
  "openai-responses": "OpenAI Responses API",
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: a harness shows only the provider's error text,
 * which names neither the provider, the model nor the API, so a person
 * cannot tell a provider fault from a platform one. The message gains one
 * leading sentence naming them; a non-JSON body becomes the dialect's error
 * shape.
 */
export function explainUpstreamError(input: {
  status: number;
  text: string;
  dialect: ModelDialect;
  harness: string;
  provider: string;
  upstreamId: string;
}): string {
  const lead = `${input.provider} refused ${input.upstreamId} with HTTP ${input.status} on the ${API_NAME[input.dialect]}, which ${input.harness} uses.`;
  const parsed = parseJson(input.text);
  if (isObject(parsed) && isObject(parsed.error)) {
    const original = parsed.error.message;
    const said =
      typeof original === "string"
        ? original
        : JSON.stringify(original ?? parsed.error);
    return JSON.stringify({
      ...parsed,
      error: { ...parsed.error, message: `${lead} The provider said: ${said}` },
    });
  }
  const plain = input.text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const message = plain ? `${lead} The provider said: ${plain}` : lead;
  return input.dialect === "anthropic-messages"
    ? JSON.stringify({ type: "error", error: { type: "api_error", message } })
    : JSON.stringify({
        error: { message, type: "upstream_error", code: input.status },
      });
}

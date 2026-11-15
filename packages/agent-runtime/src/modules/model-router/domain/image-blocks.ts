import type { ModelDialect } from "../../model-catalog/index.js";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const IMAGE_PART: Record<ModelDialect, string> = {
  "anthropic-messages": "image",
  "openai-chat": "image_url",
  "openai-responses": "input_image",
};

const TEXT_PART: Record<ModelDialect, string> = {
  "anthropic-messages": "text",
  "openai-chat": "text",
  "openai-responses": "input_text",
};

const REFUSES_IMAGES =
  /not a multimodal model|does not support (?:images?|vision)|(?:image|vision) inputs? (?:is|are) not supported|support image input|image_url is only supported/i;

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a provider's error says the model does
 * not accept images, as vLLM's "is not a multimodal model" behind LiteLLM,
 * OpenRouter's "no endpoints found that support image input" and OpenAI's
 * "image_url is only supported by certain models" do.
 */
export function refusesImages(text: string): boolean {
  return REFUSES_IMAGES.test(text);
}

export function imageNote(upstreamId: string): string {
  return `[An image was attached here and left out, because the model ${upstreamId} does not accept images. Tell the user you cannot see it.]`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a model call with every image the conversation
 * carries replaced by a text note, for a model that does not accept images:
 * the provider refuses the whole call for one image anywhere in it, and a
 * Session's history sends that image again on every later turn. Images sit
 * in a message's content, in a Messages tool result's content and in a
 * Responses tool output. Null when the call carries no image.
 */
export function withoutImages(
  body: Json,
  dialect: ModelDialect,
  note: string,
): Json | null {
  let dropped = 0;
  const parts = (list: unknown[]): unknown[] =>
    list.map((part) => {
      if (!isObject(part)) return part;
      if (part.type === IMAGE_PART[dialect]) {
        dropped += 1;
        return { type: TEXT_PART[dialect], text: note };
      }
      return Array.isArray(part.content)
        ? { ...part, content: parts(part.content) }
        : part;
    });
  const item = (entry: unknown): unknown => {
    if (!isObject(entry)) return entry;
    const content = Array.isArray(entry.content)
      ? { content: parts(entry.content) }
      : {};
    const output = Array.isArray(entry.output)
      ? { output: parts(entry.output) }
      : {};
    return { ...entry, ...content, ...output };
  };
  const field = dialect === "openai-responses" ? "input" : "messages";
  const list = body[field];
  if (!Array.isArray(list)) return null;
  const rewritten = list.map(item);
  return dropped > 0 ? { ...body, [field]: rewritten } : null;
}

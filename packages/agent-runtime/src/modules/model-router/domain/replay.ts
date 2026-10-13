import type { ProviderAlias } from "api-server-api";
import type { ModelDialect } from "../../model-catalog/index.js";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function thinkingToText(blocks: unknown[]): unknown[] {
  return blocks.flatMap((block) => {
    if (!isObject(block)) return [block];
    if (block.type === "thinking") {
      const text = typeof block.thinking === "string" ? block.thinking : "";
      return text.trim()
        ? [{ type: "text", text: `<thinking>${text}</thinking>` }]
        : [];
    }
    if (block.type === "redacted_thinking") return [];
    return [block];
  });
}

const TOOL_CALLS = new Set([
  "function_call",
  "custom_tool_call",
  "local_shell_call",
]);
const TOOL_OUTPUTS = new Set([
  "function_call_output",
  "custom_tool_call_output",
  "local_shell_call_output",
]);

const textOf = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value ?? "");

function toolItemAsText(item: unknown): unknown {
  if (!isObject(item) || typeof item.type !== "string") return item;
  if (TOOL_CALLS.has(item.type))
    return {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: `[tool call ${textOf(item.name ?? item.type)}: ${textOf(item.arguments ?? item.input ?? item.action)}]`,
        },
      ],
    };
  if (TOOL_OUTPUTS.has(item.type))
    return {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: `[tool result ${textOf(item.call_id)}: ${textOf(item.output)}]`,
        },
      ],
    };
  return item;
}

const BEDROCK_THINKING_DISPLAY = new Set(["summarized", "omitted"]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Bedrock behind the LiteLLM proxies refuses a
 * `thinking.display` value it does not know, so off Anthropic's own API such
 * a value is dropped.
 */
function bedrockThinking(body: Json, alias: ProviderAlias): Json {
  const thinking = body.thinking;
  if (alias === "anthropic" || !isObject(thinking)) return body;
  const display = thinking.display;
  if (display === undefined || BEDROCK_THINKING_DISPLAY.has(String(display)))
    return body;
  const { display: _display, ...rest } = thinking;
  return { ...body, thinking: rest };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: makes a conversation produced on one model
 * replayable on another, by target, since the router cannot know which model
 * wrote a history. A Claude target verifies thinking signatures, so earlier
 * assistant thinking blocks become text (the last message keeps them for a
 * tool loop in flight). A proxied Responses target refuses encrypted
 * reasoning items, `client_metadata`, and tool items without a tool config;
 * OpenAI itself refuses only reasoning items with a non-empty `content`.
 */
export function applyReplayRules(
  body: Json,
  target: { dialect: ModelDialect; alias: ProviderAlias; upstreamId: string },
): Json {
  switch (target.dialect) {
    case "anthropic-messages": {
      body = bedrockThinking(body, target.alias);
      if (!/claude/i.test(target.upstreamId)) return body;
      const messages = body.messages;
      if (!Array.isArray(messages)) return body;
      const lastAssistant = messages.reduce<number>(
        (last, m, i) => (isObject(m) && m.role === "assistant" ? i : last),
        -1,
      );
      let changed = false;
      const rewritten = messages.map((m, i) => {
        if (
          !isObject(m) ||
          m.role !== "assistant" ||
          i === lastAssistant ||
          !Array.isArray(m.content)
        )
          return m;
        const original: unknown[] = m.content;
        const content = thinkingToText(original);
        if (
          content.length === original.length &&
          content.every((b, j) => b === original[j])
        )
          return m;
        changed = true;
        return { ...m, content };
      });
      return changed ? { ...body, messages: rewritten } : body;
    }
    case "openai-responses": {
      const proxied = target.alias !== "openai";
      const { client_metadata: _metadata, ...withoutMetadata } = body;
      const next =
        proxied && "client_metadata" in body ? withoutMetadata : body;
      const input = next.input;
      if (!Array.isArray(input)) return next;
      const keep = (item: unknown): boolean => {
        if (!isObject(item) || item.type !== "reasoning") return true;
        if (proxied) return false;
        return !(Array.isArray(item.content) && item.content.length > 0);
      };
      const toolless = !Array.isArray(next.tools) || next.tools.length === 0;
      const items = input
        .filter(keep)
        .map((item) => (proxied && toolless ? toolItemAsText(item) : item));
      return items.length === input.length &&
        items.every((item, i) => item === input[i])
        ? next
        : { ...next, input: items };
    }
    case "openai-chat":
      return body;
  }
}

const MIN_NON_CLAUDE_OUTPUT_TOKENS = 64;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code confirms a picked model with a
 * one-token call, which the reasoning models behind the proxies cannot answer
 * within, so a non-Claude Messages call gets a floor on its output budget.
 */
export function floorOutputBudget(
  body: Json,
  target: { dialect: ModelDialect; upstreamId: string },
): Json {
  if (target.dialect !== "anthropic-messages") return body;
  if (/claude/i.test(target.upstreamId)) return body;
  const asked = body.max_tokens;
  if (typeof asked !== "number" || asked >= MIN_NON_CLAUDE_OUTPUT_TOKENS)
    return body;
  return { ...body, max_tokens: MIN_NON_CLAUDE_OUTPUT_TOKENS };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Codex sends its session's reasoning effort
 * whatever the model, and OpenAI refuses it on a model that does not reason,
 * so a model the catalog knows does not reason loses the parameter.
 */
export function dropUnsupportedReasoning(
  body: Json,
  target: { dialect: ModelDialect; reasoning: boolean | null },
): Json {
  if (target.reasoning !== false) return body;
  if (target.dialect === "openai-responses" && "reasoning" in body) {
    const { reasoning: _reasoning, ...rest } = body;
    return rest;
  }
  if (target.dialect === "openai-chat" && "reasoning_effort" in body) {
    const { reasoning_effort: _effort, ...rest } = body;
    return rest;
  }
  return body;
}

const OUTPUT_FIELD: Record<ModelDialect, string> = {
  "anthropic-messages": "max_tokens",
  "openai-chat": "max_tokens",
  "openai-responses": "max_output_tokens",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: a harness may ask for more output tokens than
 * the model allows (Bob asks for 64000 everywhere), which the provider
 * refuses, so the budget is cut to the catalog's limit. OpenAI's chat API
 * refuses `max_tokens` on its reasoning models, so a chat call to OpenAI
 * carries the budget as `max_completion_tokens`.
 */
export function fitOutputBudget(
  body: Json,
  target: {
    dialect: ModelDialect;
    alias: ProviderAlias;
    maxOutputTokens: number | null;
  },
): Json {
  const chatToOpenAi =
    target.dialect === "openai-chat" && target.alias === "openai";
  const field = OUTPUT_FIELD[target.dialect];
  const asked =
    typeof body[field] === "number"
      ? (body[field] as number)
      : chatToOpenAi && typeof body.max_completion_tokens === "number"
        ? body.max_completion_tokens
        : null;
  if (asked === null) return body;
  const limit = target.maxOutputTokens;
  const fitted = limit !== null && limit > 0 ? Math.min(asked, limit) : asked;
  if (!chatToOpenAi)
    return fitted === asked ? body : { ...body, [field]: fitted };
  const { max_tokens: _legacy, ...rest } = body;
  return { ...rest, max_completion_tokens: fitted };
}

export function ensureStreamUsage(body: Json, dialect: ModelDialect): Json {
  if (dialect !== "openai-chat" || body.stream !== true) return body;
  if (isObject(body.stream_options)) return body;
  return { ...body, stream_options: { include_usage: true } };
}

import type { ProviderAlias } from "api-server-api";
import type { ModelDialect } from "../../model-catalog/index.js";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const THINKING = new Set(["thinking", "redacted_thinking"]);

const REFUSES_THINKING =
  /invalid `?(?:signature|data)`? in `?(?:redacted_)?thinking`? block|(?:redacted_)?thinking\.(?:signature|data): field required/i;

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a provider's error says a thinking block
 * in the history is not one a Claude model wrote: Anthropic answers a block
 * with a foreign signature with "Invalid `signature` in `thinking` block",
 * one with none with "thinking.signature: Field required", and the redacted
 * block a GPT model returns behind the proxies with "Invalid `data` in
 * `redacted_thinking` block". Any other error about thinking, such as a
 * budget one, is not answered by removing blocks and does not match.
 */
export function refusesThinking(text: string): boolean {
  return REFUSES_THINKING.test(text);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether the target checks the signature of each
 * thinking block in a Messages history, which the Claude models do, on
 * Anthropic's API and behind the proxies alike.
 */
export function verifiesThinking(target: {
  dialect: ModelDialect;
  upstreamId: string;
}): boolean {
  return (
    target.dialect === "anthropic-messages" && /claude/i.test(target.upstreamId)
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Messages call with the thinking blocks of its
 * first `upTo` messages removed, for a Claude target that refused the call
 * for a block another model wrote. The last assistant message keeps its
 * blocks for a tool loop in flight, and a message left with nothing is
 * removed, since the Messages API refuses an empty `content`. Messages from
 * `upTo` on are untouched: they were written after the refusal, so they keep
 * the model's reasoning and the provider's prompt cache keeps matching. The
 * blocks are removed and never turned into text, which would put reasoning
 * into visible replies, and Anthropic's safeguards refuse that as reasoning
 * extraction. Null when the call carries no such block.
 */
export function withoutEarlierThinking(body: Json, upTo: number): Json | null {
  const messages = body.messages;
  if (!Array.isArray(messages)) return null;
  const lastAssistant = messages.reduce<number>(
    (last, m, i) => (isObject(m) && m.role === "assistant" ? i : last),
    -1,
  );
  let changed = false;
  const rewritten = messages.flatMap((m, i) => {
    if (
      i >= upTo ||
      i === lastAssistant ||
      !isObject(m) ||
      m.role !== "assistant" ||
      !Array.isArray(m.content)
    )
      return [m];
    const original: unknown[] = m.content;
    const content = original.filter(
      (block) => !isObject(block) || !THINKING.has(String(block.type)),
    );
    if (content.length === original.length) return [m];
    changed = true;
    return content.length > 0 ? [{ ...m, content }] : [];
  });
  return changed ? { ...body, messages: rewritten } : null;
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
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code sends its persisted effort level as
 * `output_config.effort`, which vLLM hands to DeepSeek's chat template as
 * `reasoning_effort`; that template knows low, high, xhigh, max or an integer
 * and refuses the whole call on the `medium` Claude Code persists by default,
 * so it becomes the nearest level the template does.
 */
function deepseekEffort(body: Json, upstreamId: string): Json {
  if (!/deepseek/i.test(upstreamId)) return body;
  const outputConfig = body.output_config;
  if (!isObject(outputConfig) || outputConfig.effort !== "medium") return body;
  return { ...body, output_config: { ...outputConfig, effort: "high" } };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: makes a conversation produced on one model
 * replayable on another, by target, since the router cannot know which model
 * wrote a history. A Messages history goes out as the harness wrote it,
 * thinking blocks included: a Claude target accepts the blocks any Claude
 * model signed, on any provider, and the one it refuses is handled when it
 * refuses (see `withoutEarlierThinking`). A proxied Responses target refuses
 * encrypted reasoning items, `client_metadata`, and tool items without a tool
 * config; OpenAI itself refuses only reasoning items with a non-empty
 * `content`.
 */
export function applyReplayRules(
  body: Json,
  target: { dialect: ModelDialect; alias: ProviderAlias; upstreamId: string },
): Json {
  switch (target.dialect) {
    case "anthropic-messages":
      return deepseekEffort(
        bedrockThinking(body, target.alias),
        target.upstreamId,
      );
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

const IBM_LITELLM_TEMPLATE = "ibm-litellm";
const AZURE_DEEPSEEK = /^azure\/.*deepseek/i;

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether the route itself refuses a reasoning
 * effort, whatever the model reasons. Measured on the ETE proxy, the
 * `ibm-litellm` preset: its Azure-served DeepSeek deployments
 * (`azure/DeepSeek-V4.1-Flash`, `azure/DeepSeek-V3.2-ncf`) answer
 * `reasoning.effort` with HTTP 400 on the Responses API, whatever the value.
 * The same proxy's other Azure models and DeepSeek served from vLLM keep the
 * effort and reason, so only that family on that preset loses it: an id the
 * platform has not seen keeps what it sends, and a wrong guess here loses the
 * effort, never the call. Only the Responses shape carries the effort, and a
 * probe of the chat shape with `reasoning_effort` answered 200.
 */
export function refusesReasoningEffort(target: {
  dialect: ModelDialect;
  template: string;
  upstreamId: string;
}): boolean {
  if (target.dialect !== "openai-responses") return false;
  if (target.template !== IBM_LITELLM_TEMPLATE) return false;
  return AZURE_DEEPSEEK.test(target.upstreamId);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Codex sends its session's reasoning effort
 * whatever the model, and OpenAI refuses it on a model that does not reason,
 * so a model the catalog knows does not reason loses the parameter. A route
 * that refuses the effort loses it too, and there the harness's thinking
 * cannot be asked for: no effort value and no summary request brings
 * reasoning back on that API, which the probes confirmed at 0 reasoning
 * tokens.
 */
export function dropUnsupportedReasoning(
  body: Json,
  target: {
    dialect: ModelDialect;
    reasoning: boolean | null;
    template: string;
    upstreamId: string;
  },
): Json {
  if (target.reasoning !== false && !refusesReasoningEffort(target))
    return body;
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
    return fitted === asked
      ? body
      : fitThinkingBudget({ ...body, [field]: fitted }, fitted);
  const { max_tokens: _legacy, ...rest } = body;
  return { ...rest, max_completion_tokens: fitted };
}

const MIN_THINKING_BUDGET = 1024;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Messages call refuses a thinking budget at or
 * above max_tokens, so a cut output budget shrinks the thinking budget under
 * it, and drops thinking when nothing meaningful is left for it.
 */
function fitThinkingBudget(body: Json, maxTokens: number): Json {
  const thinking = isObject(body.thinking) ? body.thinking : null;
  if (
    !thinking ||
    thinking.type !== "enabled" ||
    typeof thinking.budget_tokens !== "number" ||
    thinking.budget_tokens < maxTokens
  )
    return body;
  const budget = maxTokens - 1;
  if (budget < MIN_THINKING_BUDGET) {
    const { thinking: _dropped, ...rest } = body;
    return rest;
  }
  return { ...body, thinking: { ...thinking, budget_tokens: budget } };
}

export function ensureStreamUsage(body: Json, dialect: ModelDialect): Json {
  if (dialect !== "openai-chat" || body.stream !== true) return body;
  if (isObject(body.stream_options)) return body;
  return { ...body, stream_options: { include_usage: true } };
}

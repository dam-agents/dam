import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { ModelDialect, ModelPrices } from "../../model-catalog/index.js";

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export type UncountedReason = "no-usage-event" | "unpriced" | "error";

type Json = Record<string, unknown>;

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

const count = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Messages stream reports its counts in
 * message_start and again, cumulative, in message_delta, where a provider
 * may send null or 0 for a count it has not changed; a field counts only
 * when it is a number, and the larger of the two reports stands.
 */
function messagesUsage(raw: Json): Partial<ModelUsage> {
  const fields: [keyof ModelUsage, string][] = [
    ["inputTokens", "input_tokens"],
    ["outputTokens", "output_tokens"],
    ["cacheReadTokens", "cache_read_input_tokens"],
    ["cacheCreationTokens", "cache_creation_input_tokens"],
  ];
  const out: Partial<ModelUsage> = {};
  for (const [key, field] of fields) {
    const value = count(raw[field]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function mergeUsage(
  base: Partial<ModelUsage> | null,
  next: Partial<ModelUsage>,
): Partial<ModelUsage> {
  const out: Partial<ModelUsage> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(next) as [
    keyof ModelUsage,
    number,
  ][])
    out[key] = Math.max(out[key] ?? 0, value);
  return out;
}

function chatUsage(raw: Json): ModelUsage {
  const cached = num(obj(raw.prompt_tokens_details)?.cached_tokens);
  return {
    inputTokens: Math.max(0, num(raw.prompt_tokens) - cached),
    outputTokens: num(raw.completion_tokens),
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
  };
}

function responsesUsage(raw: Json): ModelUsage {
  const cached = num(obj(raw.input_tokens_details)?.cached_tokens);
  return {
    inputTokens: Math.max(0, num(raw.input_tokens) - cached),
    outputTokens: num(raw.output_tokens),
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
  };
}

const complete = (partial: Partial<ModelUsage>): ModelUsage => ({
  inputTokens: partial.inputTokens ?? 0,
  outputTokens: partial.outputTokens ?? 0,
  cacheReadTokens: partial.cacheReadTokens ?? 0,
  cacheCreationTokens: partial.cacheCreationTokens ?? 0,
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: the token counts of one unstreamed response.
 * Input tokens are the uncached ones, as Claude Code reports them; the OpenAI
 * dialects fold the cached share into their prompt count, so it is split
 * back out.
 */
export function usageOfBody(
  dialect: ModelDialect,
  text: string,
): ModelUsage | null {
  let json: Json | null;
  try {
    json = obj(JSON.parse(text));
  } catch {
    return null;
  }
  const raw = obj(json?.usage);
  if (!raw) return null;
  switch (dialect) {
    case "anthropic-messages":
      return complete(messagesUsage(raw));
    case "openai-chat":
      return chatUsage(raw);
    case "openai-responses":
      return responsesUsage(raw);
  }
}

export interface UsageScanner extends Transform {
  usage(): ModelUsage | null;
  completed(): boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the token counts of one streamed response, read
 * off the stream one line at a time so the response is never buffered. A
 * stream cut before its usage event has none, which the call record reports
 * as uncounted rather than zero; `completed` says the usage event went by,
 * so a client that closes right after it still had a whole call.
 */
export function createUsageScanner(dialect: ModelDialect): UsageScanner {
  let partial: Partial<ModelUsage> | null = null;
  let found = false;
  let finished = false;
  let pending = "";
  const see = (line: string): void => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let event: Json | null;
    try {
      event = obj(JSON.parse(payload));
    } catch {
      return;
    }
    if (!event) return;
    switch (dialect) {
      case "anthropic-messages": {
        const raw =
          event.type === "message_start"
            ? obj(obj(event.message)?.usage)
            : event.type === "message_delta"
              ? obj(event.usage)
              : null;
        if (!raw) return;
        partial = mergeUsage(partial, messagesUsage(raw));
        found = true;
        if (event.type === "message_delta") finished = true;
        return;
      }
      case "openai-chat": {
        const raw = obj(event.usage);
        if (!raw) return;
        partial = chatUsage(raw);
        found = true;
        finished = true;
        return;
      }
      case "openai-responses": {
        if (
          event.type !== "response.completed" &&
          event.type !== "response.incomplete"
        )
          return;
        const raw = obj(obj(event.response)?.usage);
        if (!raw) return;
        partial = responsesUsage(raw);
        found = true;
        finished = true;
        return;
      }
    }
  };
  const decoder = new StringDecoder("utf8");
  const scanner = new Transform({
    transform(chunk: Buffer, _enc, done) {
      pending += decoder.write(chunk);
      let at = pending.indexOf("\n");
      while (at !== -1) {
        see(pending.slice(0, at).replace(/\r$/, ""));
        pending = pending.slice(at + 1);
        at = pending.indexOf("\n");
      }
      done(null, chunk);
    },
    flush(done) {
      pending += decoder.end();
      if (pending) see(pending);
      pending = "";
      done();
    },
  }) as UsageScanner;
  scanner.usage = () => (found && partial ? complete(partial) : null);
  scanner.completed = () => finished;
  return scanner;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: integer micro-dollars, the unit the spend reader
 * sums. A cache class the price list does not price is charged as plain
 * input; null when the model has no price, which the record reports as
 * unpriced rather than free.
 */
export function costUsdMicros(
  prices: ModelPrices | null,
  usage: ModelUsage,
): number | null {
  if (!prices) return null;
  const usd =
    usage.inputTokens * prices.inputPerToken +
    usage.outputTokens * prices.outputPerToken +
    usage.cacheReadTokens * (prices.cacheReadPerToken ?? prices.inputPerToken) +
    usage.cacheCreationTokens *
      (prices.cacheWritePerToken ?? prices.inputPerToken);
  return Math.round(usd * 1e6);
}

const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness's own trace context, so the call's
 * spend record joins the session's trace beside the harness's spans.
 */
export function traceOf(
  header: string | string[] | undefined,
): { traceId: string; spanId: string } | null {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  const m = value ? TRACEPARENT.exec(value) : null;
  return m
    ? { traceId: m[1]!.toLowerCase(), spanId: m[2]!.toLowerCase() }
    : null;
}

import type { ApiDialect, RawUsage } from "../domain/call.js";

export const SPEND_METADATA_NAMESPACE = "platform.spend";

export interface SpendMetadata {
  readonly callId: string;
  readonly payer: string;
  readonly path: string;
  readonly dialect: ApiDialect;
  readonly providers: readonly string[];
  readonly connectionId: string | null;
  readonly sessionId: string | null;
  readonly harness: string | null;
  readonly model: string | null;
  readonly usage: RawUsage;
  readonly replyBytes: number | null;
  readonly complete: boolean;
}

const DIALECTS: ReadonlySet<string> = new Set<ApiDialect>([
  "anthropic-messages",
  "openai-chat",
  "openai-responses",
  "openai-embeddings",
  "bedrock-invoke",
  "bedrock-converse",
]);

export function parseSpendMetadata(
  fields: Record<string, unknown> | undefined,
): SpendMetadata | null {
  if (!fields || fields.billable !== true) return null;
  const callId = text(fields.call_id);
  const payer = text(fields.payer);
  const dialect = text(fields.dialect);
  if (!callId || !payer || !dialect || !DIALECTS.has(dialect)) return null;
  return {
    callId,
    payer,
    path: text(fields.path) ?? "",
    dialect: dialect as ApiDialect,
    providers: (text(fields.providers) ?? "").split(",").filter(Boolean),
    connectionId: text(fields.conn) ?? null,
    sessionId: text(fields.session) ?? null,
    harness: text(fields.harness) ?? null,
    model: text(fields.model) ?? null,
    usage: {
      inputTokens: amount(fields.input_tokens),
      outputTokens: amount(fields.output_tokens),
      cacheReadTokens: amount(fields.cache_read_tokens),
      cacheWriteTokens: amount(fields.cache_write_tokens),
      cacheWrite5mTokens: amount(fields.cache_write_5m_tokens),
      cacheWrite1hTokens: amount(fields.cache_write_1h_tokens),
      cachedTokens: amount(fields.cached_tokens),
      webSearchRequests: amount(fields.web_search_requests),
      webSearchCalls: amount(fields.web_search_calls),
      credits: amount(fields.credits),
      serviceTier: text(fields.service_tier),
      speed: text(fields.speed),
      inferenceGeo: text(fields.inference_geo),
    },
    replyBytes: amount(fields.bytes) ?? null,
    complete: fields.complete === true,
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function amount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

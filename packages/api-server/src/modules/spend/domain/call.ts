import { callCostMicros } from "./cost.js";
import { lookupPrice, type PriceBook, type PriceSource } from "./prices.js";
import { payingProvider, unitOf, type SpendUnit } from "./units.js";
import type { NormalizedUsage } from "./usage.js";
import { UNKNOWN_MODEL, type CallAmounts } from "./ledger.js";

export type ApiDialect =
  | "anthropic-messages"
  | "openai-chat"
  | "openai-responses"
  | "openai-embeddings"
  | "bedrock-invoke"
  | "bedrock-converse";

export interface RawUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheWrite5mTokens?: number;
  readonly cacheWrite1hTokens?: number;
  readonly cachedTokens?: number;
  readonly webSearchRequests?: number;
  readonly webSearchCalls?: number;
  readonly credits?: number;
  readonly serviceTier?: string;
  readonly speed?: string;
  readonly inferenceGeo?: string;
}

export interface CallRecord {
  readonly callId: string;
  readonly agentId: string;
  readonly payer: string;
  readonly connectionId: string | null;
  readonly providers: readonly string[];
  readonly sessionId: string | null;
  readonly harness: string | null;
  readonly path: string;
  readonly dialect: ApiDialect;
  readonly model: string | null;
  readonly usage: RawUsage;
  readonly status: number | null;
  readonly replyBytes: number | null;
  readonly complete: boolean;
  readonly proxyCost: string | null;
  readonly final: boolean;
  readonly refusedByGate: boolean;
  readonly startedAt: Date;
  readonly durationMs: number;
}

export type CallMeasure =
  | { readonly kind: "forget" }
  | { readonly kind: "skip" }
  | {
      readonly kind: "measured";
      readonly provider: string;
      readonly unit: SpendUnit;
      readonly model: string;
      readonly priceSource: PriceSource;
      readonly needsReferenceCost: boolean;
      readonly amounts: CallAmounts;
    };

const REPLY_BYTES_PER_TOKEN = 3;

export function measureCall(record: CallRecord, book: PriceBook): CallMeasure {
  if (record.refusedByGate) return { kind: "forget" };
  const reported = hasUsage(record.usage);
  if (!reported && !record.final) return { kind: "skip" };
  if (!reported && record.status !== null && !succeeded(record.status))
    return { kind: "forget" };

  const { provider, ambiguous } = payingProvider(record.providers);
  const usage = normalizeUsage(record.dialect, record.usage);
  const outputShort =
    record.final &&
    record.dialect !== "openai-embeddings" &&
    (!record.complete || record.usage.outputTokens === undefined);
  const metered: NormalizedUsage = outputShort
    ? {
        ...usage,
        outputTokens: Math.max(
          usage.outputTokens,
          Math.ceil((record.replyBytes ?? 0) / REPLY_BYTES_PER_TOKEN),
        ),
      }
    : usage;
  const price = lookupPrice(book, {
    provider,
    replyModel: record.model,
    pathModel: bedrockPathModel(record.path),
  });
  const cost = callCostMicros(price, metered);
  const needsReferenceCost = record.final && (cost === null || !reported);
  const estimated =
    outputShort ||
    ambiguous ||
    price.source === "estimate" ||
    needsReferenceCost;
  return {
    kind: "measured",
    provider,
    unit: unitOf(provider),
    model: record.model ?? UNKNOWN_MODEL,
    priceSource: price.source,
    needsReferenceCost,
    amounts: {
      costMicros: cost ?? 0,
      uncachedInputTokens: metered.uncachedInputTokens,
      outputTokens: metered.outputTokens,
      cacheReadTokens: metered.cacheReadTokens,
      cacheWrite5mTokens: metered.cacheWrite5mTokens,
      cacheWrite1hTokens:
        metered.cacheWrite1hTokens + metered.cacheWriteUnsplitTokens,
      webSearches: metered.webSearches,
      calls: 1,
      estimatedCalls: estimated ? 1 : 0,
    },
  };
}

export function normalizeUsage(
  dialect: ApiDialect,
  raw: RawUsage,
): NormalizedUsage {
  const cacheRead = Math.max(raw.cacheReadTokens ?? 0, raw.cachedTokens ?? 0);
  const cacheWrite = raw.cacheWriteTokens ?? 0;
  const split5m = raw.cacheWrite5mTokens ?? 0;
  const split1h = raw.cacheWrite1hTokens ?? 0;
  const promptHoldsCache = dialect.startsWith("openai-");
  const input = raw.inputTokens ?? 0;
  return {
    uncachedInputTokens: promptHoldsCache
      ? Math.max(0, input - cacheRead - cacheWrite)
      : input,
    outputTokens: raw.outputTokens ?? 0,
    cacheReadTokens: cacheRead,
    cacheWrite5mTokens: split5m,
    cacheWrite1hTokens: split1h,
    cacheWriteUnsplitTokens: Math.max(0, cacheWrite - split5m - split1h),
    webSearches: Math.max(raw.webSearchRequests ?? 0, raw.webSearchCalls ?? 0),
    bobCredits: raw.credits ?? null,
    serviceTier: raw.serviceTier ?? null,
    speed: raw.speed ?? null,
    inferenceGeo: raw.inferenceGeo ?? null,
  };
}

function hasUsage(raw: RawUsage): boolean {
  return [
    raw.inputTokens,
    raw.outputTokens,
    raw.cacheReadTokens,
    raw.cacheWriteTokens,
    raw.cachedTokens,
    raw.credits,
  ].some((count) => count !== undefined);
}

function succeeded(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

function bedrockPathModel(path: string): string | null {
  const id = /\/model\/([^/]+)\/(?:invoke|converse)/.exec(path)?.[1];
  if (!id) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

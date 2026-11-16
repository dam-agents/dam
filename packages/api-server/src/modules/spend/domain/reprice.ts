import { callCostMicros } from "./cost.js";
import { lookupPrice, type PriceBook } from "./prices.js";
import type { NormalizedUsage } from "./usage.js";

export type RepriceKind = "awaiting" | "backfill";

export interface RepriceCandidate {
  readonly callingAgentId: string;
  readonly callId: string;
  readonly provider: string;
  readonly model: string;
  readonly priceModel: string;
  readonly estimated: boolean;
  readonly estimateReasons: readonly string[];
  readonly uncachedInputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWrite5mTokens: number;
  readonly cacheWrite1hTokens: number;
  readonly webSearches: number;
}

export interface CallReprice {
  readonly callingAgentId: string;
  readonly callId: string;
  readonly expectedSource: string;
  readonly costMicros: number;
  readonly priceSource: string;
  readonly priceModel: string;
  readonly estimated: boolean;
  readonly estimateReasons: readonly string[];
}

export const REPRICED_SOURCE: Readonly<Record<RepriceKind, string>> = {
  awaiting: "awaiting",
  backfill: "",
};

const AWAITING_REASON = "awaiting-price";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the new price of a call row that was priced
 * before its model had a price: a call that waited for its price, or an
 * estimate written before calls recorded where their price came from. The
 * cost comes from the row's own token counts and the price book's current
 * price for its model, at the standard tier, because a row keeps no tier. A
 * waiting call stops being an estimate unless another reason remains, such as
 * a cut stream; an old estimate stays marked, because its row does not say
 * why it was estimated. Null while the book still has no price for it.
 */
export function repriceCall(
  candidate: RepriceCandidate,
  kind: RepriceKind,
  book: PriceBook,
): CallReprice | null {
  const usage: NormalizedUsage = {
    uncachedInputTokens: candidate.uncachedInputTokens,
    outputTokens: candidate.outputTokens,
    cacheReadTokens: candidate.cacheReadTokens,
    cacheWrite5mTokens: candidate.cacheWrite5mTokens,
    cacheWrite1hTokens: candidate.cacheWrite1hTokens,
    cacheWriteUnsplitTokens: 0,
    webSearches: candidate.webSearches,
    bobCredits: null,
    serviceTier: null,
    speed: null,
    inferenceGeo: null,
  };
  const awaiting = kind === "awaiting";
  const price = lookupPrice(book, {
    provider: candidate.provider,
    replyModel: candidate.model,
    pathModel: null,
    modelGroup: awaiting && candidate.priceModel ? candidate.priceModel : null,
    replyCostMicros: null,
    webSearches: candidate.webSearches,
  });
  if (price.kind !== "row") return null;
  const reasons = awaiting
    ? candidate.estimateReasons.filter((reason) => reason !== AWAITING_REASON)
    : candidate.estimateReasons;
  return {
    callingAgentId: candidate.callingAgentId,
    callId: candidate.callId,
    expectedSource: REPRICED_SOURCE[kind],
    costMicros: callCostMicros(price, usage) ?? 0,
    priceSource: price.source,
    priceModel: awaiting ? candidate.priceModel : candidate.model,
    estimated: awaiting ? reasons.length > 0 : candidate.estimated,
    estimateReasons: reasons,
  };
}

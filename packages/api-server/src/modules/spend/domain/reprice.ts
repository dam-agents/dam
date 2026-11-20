import { callCostMicros } from "./cost.js";
import { lookupPrice, type CallPrice, type PriceBook } from "./prices.js";
import type { NormalizedUsage } from "./usage.js";

export type RepriceKind = "awaiting" | "backfill" | "guess";

export interface RepriceCandidate {
  readonly callingAgentId: string;
  readonly callId: string;
  readonly provider: string;
  readonly model: string;
  readonly priceModel: string;
  readonly priceSource: string;
  readonly costMicros: number;
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

export const UNRECORDED_SOURCE = "";
export const GUESS_SOURCE = "estimate";
export const GUESS_REASON = "model-unpriced";
const AWAITING_REASON = "awaiting-price";
const FAST_FACTOR = "fast";

type Change = Omit<CallReprice, "callingAgentId" | "callId" | "expectedSource">;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the new price of a call row that was priced
 * before its model had a price: a call that waited for its price, an estimate
 * written before calls recorded where their price came from, or a guess from
 * the highest prices of the model's family. The cost comes from the row's own
 * token counts and the price book's current price for its model, at the
 * standard tier, because a row keeps no tier. A waiting call and a guess stop
 * being an estimate unless another reason remains, such as a cut stream; an
 * old estimate stays marked, because its row does not say why it was
 * estimated. Such an old row may also hold a real price, for example a cut
 * stream priced from the Anthropic table with its fast-mode factor, so it
 * keeps a cost that its model's price explains at one of the price's factors.
 * A guess whose model still has no price costs nothing and waits for its
 * price. Null while the book still has no price for it, and for a row without
 * input tokens: such a call had no usage, so its cost came from the payer's
 * most expensive call or from nothing, never from a price.
 */
export function repriceCall(
  candidate: RepriceCandidate,
  kind: RepriceKind,
  book: PriceBook,
): CallReprice | null {
  const inputTokens =
    candidate.uncachedInputTokens +
    candidate.cacheReadTokens +
    candidate.cacheWrite5mTokens +
    candidate.cacheWrite1hTokens;
  if (inputTokens === 0) return null;
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
  const change =
    kind === "guess"
      ? guessChange(candidate, price, usage)
      : pricedChange(candidate, awaiting, price, usage);
  return change
    ? {
        callingAgentId: candidate.callingAgentId,
        callId: candidate.callId,
        expectedSource: candidate.priceSource,
        ...change,
      }
    : null;
}

function pricedChange(
  candidate: RepriceCandidate,
  awaiting: boolean,
  price: CallPrice,
  usage: NormalizedUsage,
): Change | null {
  if (price.kind !== "row") return null;
  const reasons = awaiting
    ? candidate.estimateReasons.filter((reason) => reason !== AWAITING_REASON)
    : candidate.estimateReasons;
  return {
    costMicros: callCostMicros(price, usage) ?? 0,
    priceSource: price.source,
    priceModel: awaiting ? candidate.priceModel : candidate.model,
    estimated: awaiting ? reasons.length > 0 : candidate.estimated,
    estimateReasons: reasons,
  };
}

function guessChange(
  candidate: RepriceCandidate,
  price: CallPrice,
  usage: NormalizedUsage,
): Change | null {
  const reasons = candidate.estimateReasons.filter(
    (reason) => reason !== GUESS_REASON,
  );
  if (price.kind === "awaiting")
    return {
      costMicros: 0,
      priceSource: price.source,
      priceModel: candidate.model,
      estimated: true,
      estimateReasons: [...reasons, AWAITING_REASON],
    };
  if (price.kind !== "row") return null;
  const unrecorded = candidate.priceSource === UNRECORDED_SOURCE;
  const explained = unrecorded
    ? factoredCosts(price, usage).includes(candidate.costMicros)
    : false;
  return {
    costMicros: explained
      ? candidate.costMicros
      : (callCostMicros(price, usage) ?? 0),
    priceSource: price.source,
    priceModel: candidate.model,
    estimated: unrecorded || reasons.length > 0,
    estimateReasons: reasons,
  };
}

function factoredCosts(
  price: CallPrice & { kind: "row" },
  usage: NormalizedUsage,
): number[] {
  const factors = Object.keys(price.row.factors ?? {});
  const speeds = [null, ...factors.filter((f) => f === FAST_FACTOR)];
  const geos = [null, ...factors.filter((f) => f !== FAST_FACTOR)];
  return speeds.flatMap((speed) =>
    geos.map(
      (inferenceGeo) =>
        callCostMicros(price, { ...usage, speed, inferenceGeo }) ?? 0,
    ),
  );
}

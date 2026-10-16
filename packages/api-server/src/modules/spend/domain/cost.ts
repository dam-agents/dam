import { match } from "ts-pattern";
import type { CallPrice, PriceRow, TierPrices, TokenPrices } from "./prices.js";
import { promptTokens, type NormalizedUsage } from "./usage.js";

const MILLION = 1_000_000n;
const FACTOR_SCALE = 1_000n;
const NEUTRAL_GEOS: ReadonlySet<string> = new Set(["global", "not_available"]);

export function callCostMicros(
  price: CallPrice,
  usage: NormalizedUsage,
): number | null {
  return match(price)
    .with({ kind: "row" }, ({ row }) => rowCostMicros(row, usage))
    .with({ kind: "zero" }, () => 0)
    .with({ kind: "credits" }, () => creditsMicros(usage.bobCredits))
    .with({ kind: "unpriced" }, () => 0)
    .exhaustive();
}

export function proxyCostDifference(
  ourMicros: number,
  headerDollars: string | null,
): number | null {
  const header = headerDollars === null ? NaN : Number(headerDollars);
  if (!Number.isFinite(header) || header <= 0) return null;
  const headerMicros = header * 1_000_000;
  return Math.abs(ourMicros - headerMicros) / headerMicros;
}

function rowCostMicros(row: PriceRow, usage: NormalizedUsage): number {
  const rates = resolveRates(row, usage);
  const tokenCost =
    BigInt(usage.uncachedInputTokens) * BigInt(rates.input) +
    BigInt(usage.outputTokens) * BigInt(rates.output) +
    BigInt(usage.cacheReadTokens) * BigInt(rates.cacheRead) +
    BigInt(usage.cacheWrite5mTokens) * BigInt(rates.cacheWrite5m) +
    BigInt(usage.cacheWrite1hTokens + usage.cacheWriteUnsplitTokens) *
      BigInt(rates.cacheWrite1h);
  const factor =
    scaledFactor(speedFactor(row, usage.speed)) *
    scaledFactor(geoFactor(row, usage.inferenceGeo));
  const denominator = MILLION * FACTOR_SCALE * FACTOR_SCALE;
  const webSearchCost =
    BigInt(usage.webSearches) * BigInt(row.webSearchMicros ?? 0) * denominator;
  return Number(ceilDiv(tokenCost * factor + webSearchCost, denominator));
}

interface ResolvedRates {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}

function resolveRates(row: PriceRow, usage: NormalizedUsage): ResolvedRates {
  const tier = tierPrices(row, usage.serviceTier);
  const above =
    row.threshold !== undefined &&
    promptTokens(usage) > row.threshold.promptTokens;
  const layers: readonly (TokenPrices | undefined)[] = [
    above ? tier?.aboveThreshold : undefined,
    above ? row.threshold?.prices : undefined,
    tier?.prices,
    row.prices,
  ];
  const pick = (kind: keyof TokenPrices) =>
    layers.map((layer) => layer?.[kind]).find((v) => v !== undefined);
  const input = pick("input") ?? row.prices.input;
  const cacheWrite5m = pick("cacheWrite5m") ?? input;
  return {
    input,
    output: pick("output") ?? row.prices.output,
    cacheRead: pick("cacheRead") ?? input,
    cacheWrite5m,
    cacheWrite1h: pick("cacheWrite1h") ?? cacheWrite5m,
  };
}

function tierPrices(
  row: PriceRow,
  serviceTier: string | null,
): TierPrices | undefined {
  const tier = serviceTier?.toLowerCase();
  return tier === "flex" || tier === "priority" ? row.tiers?.[tier] : undefined;
}

function speedFactor(row: PriceRow, speed: string | null): number {
  return speed?.toLowerCase() === "fast" ? (row.factors?.fast ?? 1) : 1;
}

function geoFactor(row: PriceRow, geo: string | null): number {
  const key = geo?.toLowerCase();
  if (!key || NEUTRAL_GEOS.has(key)) return 1;
  return row.factors?.[key] ?? 1;
}

function scaledFactor(factor: number): bigint {
  return BigInt(Math.round(factor * Number(FACTOR_SCALE)));
}

function creditsMicros(credits: number | null): number | null {
  if (credits === null) return null;
  return Math.ceil(Number((credits * 1_000_000).toPrecision(12)));
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

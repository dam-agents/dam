import type {
  PricedModel,
  ServiceTierName,
  TierPrices,
  TokenPrices,
} from "../domain/prices.js";

interface DollarTokenPrices {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite5m?: number;
  readonly cacheWrite1h?: number;
}

interface DollarTierPrices extends DollarTokenPrices {
  readonly aboveThreshold?: DollarTokenPrices;
}

export interface OperatorPriceInput extends DollarTokenPrices {
  readonly provider: string;
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly webSearch?: number;
  readonly threshold?: DollarTokenPrices & { readonly promptTokens: number };
  readonly flex?: DollarTierPrices;
  readonly priority?: DollarTierPrices;
  readonly factors?: Readonly<Record<string, number>>;
}

const MICROS_PER_DOLLAR = 1e6;
const TIERS: readonly ServiceTierName[] = ["flex", "priority"];

export function operatorPrices(
  inputs: readonly OperatorPriceInput[],
): PricedModel[] {
  return inputs.map((input) => {
    const tiers: Partial<Record<ServiceTierName, TierPrices>> = {};
    for (const tier of TIERS) {
      const prices = input[tier];
      if (!prices) continue;
      tiers[tier] = prices.aboveThreshold
        ? {
            prices: tokenPrices(prices),
            aboveThreshold: tokenPrices(prices.aboveThreshold),
          }
        : { prices: tokenPrices(prices) };
    }
    return {
      provider: input.provider,
      model: input.model,
      row: {
        prices: {
          ...tokenPrices(input),
          input: micros(input.input),
          output: micros(input.output),
        },
        ...(input.webSearch === undefined
          ? {}
          : { webSearchMicros: micros(input.webSearch) }),
        ...(input.threshold
          ? {
              threshold: {
                promptTokens: input.threshold.promptTokens,
                prices: tokenPrices(input.threshold),
              },
            }
          : {}),
        ...(Object.keys(tiers).length > 0 ? { tiers } : {}),
        ...(input.factors ? { factors: input.factors } : {}),
      },
    };
  });
}

function tokenPrices(prices: DollarTokenPrices): TokenPrices {
  const entries = (
    [
      ["input", prices.input],
      ["output", prices.output],
      ["cacheRead", prices.cacheRead],
      ["cacheWrite5m", prices.cacheWrite5m],
      ["cacheWrite1h", prices.cacheWrite1h],
    ] as const
  ).filter((entry): entry is readonly [keyof TokenPrices, number] =>
    Number.isFinite(entry[1]),
  );
  return Object.fromEntries(
    entries.map(([kind, dollars]) => [kind, micros(dollars)]),
  );
}

function micros(dollars: number): number {
  return Math.round(dollars * MICROS_PER_DOLLAR);
}

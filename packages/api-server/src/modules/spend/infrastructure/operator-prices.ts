import type {
  PricedModel,
  PriceStep,
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

interface DollarPriceStep extends DollarTokenPrices {
  readonly promptTokens: number;
}

interface DollarTierPrices extends DollarTokenPrices {
  readonly aboveThreshold?: DollarTokenPrices;
  readonly thresholds?: readonly DollarPriceStep[];
}

export interface OperatorPriceInput extends DollarTokenPrices {
  readonly provider: string;
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly webSearch?: number;
  readonly threshold?: DollarPriceStep;
  readonly thresholds?: readonly DollarPriceStep[];
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
      const tierSteps = priceSteps([
        ...(prices.aboveThreshold && input.threshold
          ? [
              {
                ...prices.aboveThreshold,
                promptTokens: input.threshold.promptTokens,
              },
            ]
          : []),
        ...(prices.thresholds ?? []),
      ]);
      tiers[tier] =
        tierSteps.length > 0
          ? { prices: tokenPrices(prices), thresholds: tierSteps }
          : { prices: tokenPrices(prices) };
    }
    const steps = priceSteps([
      ...(input.threshold ? [input.threshold] : []),
      ...(input.thresholds ?? []),
    ]);
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
        ...(steps.length > 0 ? { thresholds: steps } : {}),
        ...(Object.keys(tiers).length > 0 ? { tiers } : {}),
        ...(input.factors ? { factors: input.factors } : {}),
      },
    };
  });
}

function priceSteps(steps: readonly DollarPriceStep[]): PriceStep[] {
  return [...steps]
    .sort((a, b) => a.promptTokens - b.promptTokens)
    .map((step) => ({
      promptTokens: step.promptTokens,
      prices: tokenPrices(step),
    }));
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

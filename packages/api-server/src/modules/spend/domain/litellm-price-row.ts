import type {
  PriceRow,
  PriceStep,
  ServiceTierName,
  TierPrices,
  TokenPrices,
} from "./prices.js";

export type LiteLlmPriceFields = Readonly<Record<string, unknown>>;

export interface LiteLlmPrice {
  readonly row: PriceRow;
  readonly freeSearchQuota: boolean;
  readonly incomplete: readonly string[];
}

const PICO_PER_DOLLAR = 1e12;
const MICROS_PER_DOLLAR = 1e6;
const TIERS: readonly ServiceTierName[] = ["flex", "priority"];
const STEP_KEY =
  /^(?:input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)_above_(\d+)(k?)_tokens/;

/**
 * UNIT_BOUNDARY_DESCRIPTION: turns one model's LiteLLM price fields into
 * DAM's price row, by LiteLLM's own key names: the base, flex and priority
 * prices of each kind of token, every prompt-size step, and the web search.
 * It also names each field that changes LiteLLM's cost but that DAM does not
 * apply: a reasoning-token price unlike the output price, a regional uplift,
 * web-search prices that differ by context size, a free search quota. Null
 * when the model has no input or output price.
 */
export function liteLlmPrice(fields: LiteLlmPriceFields): LiteLlmPrice | null {
  const price = (field: string): number | undefined => {
    const dollars = numberAt(fields, field);
    return dollars === undefined
      ? undefined
      : Math.round(dollars * PICO_PER_DOLLAR);
  };
  const prices = (suffix: string): TokenPrices =>
    definedOnly({
      input: price(`input_cost_per_token${suffix}`),
      output: price(`output_cost_per_token${suffix}`),
      cacheRead: price(`cache_read_input_token_cost${suffix}`),
      cacheWrite5m: price(`cache_creation_input_token_cost${suffix}`),
      cacheWrite1h: price(`cache_creation_input_token_cost_above_1hr${suffix}`),
    });

  const base = prices("");
  if (base.input === undefined || base.output === undefined) return null;

  const stepNames = new Set(
    Object.keys(fields).flatMap((field) => {
      const step = STEP_KEY.exec(field);
      return step ? [`${step[1]}${step[2]}`] : [];
    }),
  );
  const steps = (suffix: (above: string) => string): PriceStep[] =>
    [...stepNames]
      .map((name) => ({
        promptTokens:
          Number(name.replace("k", "")) * (name.endsWith("k") ? 1000 : 1),
        prices: prices(suffix(`_above_${name}_tokens`)),
      }))
      .filter((step) => !isEmpty(step.prices))
      .sort((a, b) => a.promptTokens - b.promptTokens);

  const tiers: Partial<Record<ServiceTierName, TierPrices>> = {};
  for (const tier of TIERS) {
    const tierPrices = prices(`_${tier}`);
    const tierSteps = steps((above) => `${above}_${tier}`);
    if (isEmpty(tierPrices) && tierSteps.length === 0) continue;
    tiers[tier] =
      tierSteps.length === 0
        ? { prices: tierPrices }
        : { prices: tierPrices, thresholds: tierSteps };
  }
  const rowSteps = steps((above) => above);

  const webSearch =
    numberAt(fields, "web_search_cost_per_query") ??
    searchSizePrices(fields).search_context_size_medium;
  const factors = numberRecord(fields.price_factors);
  return {
    row: {
      prices: { ...base, input: base.input, output: base.output },
      ...(webSearch === undefined
        ? {}
        : { webSearchMicros: Math.round(webSearch * MICROS_PER_DOLLAR) }),
      ...(rowSteps.length > 0 ? { thresholds: rowSteps } : {}),
      ...(isEmpty(tiers) ? {} : { tiers }),
      ...(factors ? { factors } : {}),
    },
    freeSearchQuota: present(fields.search_free_requests),
    incomplete: incompleteFields(fields),
  };
}

function incompleteFields(fields: LiteLlmPriceFields): string[] {
  const reasoning = numberAt(fields, "output_cost_per_reasoning_token");
  const uplift = numberAt(fields, "regional_endpoint_uplift_multiplier");
  const sizes = new Set(Object.values(searchSizePrices(fields)));
  return [
    reasoning !== undefined &&
      reasoning !== numberAt(fields, "output_cost_per_token") &&
      "output_cost_per_reasoning_token",
    uplift !== undefined &&
      uplift !== 1 &&
      "regional_endpoint_uplift_multiplier",
    sizes.size > 1 && "search_context_cost_per_query",
    present(fields.search_free_requests) && "search_free_requests",
  ].filter((field): field is string => typeof field === "string");
}

function searchSizePrices(
  fields: LiteLlmPriceFields,
): Readonly<Record<string, number>> {
  return numberRecord(fields.search_context_cost_per_query) ?? {};
}

function numberAt(
  fields: LiteLlmPriceFields,
  field: string,
): number | undefined {
  const value = fields[field];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function definedOnly(prices: TokenPrices): TokenPrices {
  return Object.fromEntries(
    Object.entries(prices).filter(([, value]) => value !== undefined),
  );
}

function isEmpty(value: object): boolean {
  return Object.keys(value).length === 0;
}

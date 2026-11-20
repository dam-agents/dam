export type MicrosPerMillionTokens = number;

export interface TokenPrices {
  readonly input?: MicrosPerMillionTokens;
  readonly output?: MicrosPerMillionTokens;
  readonly cacheRead?: MicrosPerMillionTokens;
  readonly cacheWrite5m?: MicrosPerMillionTokens;
  readonly cacheWrite1h?: MicrosPerMillionTokens;
}

export type BaseTokenPrices = TokenPrices & {
  readonly input: MicrosPerMillionTokens;
  readonly output: MicrosPerMillionTokens;
};

export type ServiceTierName = "flex" | "priority";

export interface PriceStep {
  readonly promptTokens: number;
  readonly prices: TokenPrices;
}

export interface TierPrices {
  readonly prices: TokenPrices;
  readonly thresholds?: readonly PriceStep[];
}

export interface PriceRow {
  readonly prices: BaseTokenPrices;
  readonly webSearchMicros?: number;
  readonly thresholds?: readonly PriceStep[];
  readonly tiers?: Readonly<Partial<Record<ServiceTierName, TierPrices>>>;
  readonly factors?: Readonly<Record<string, number>>;
}

export interface PricedModel {
  readonly provider: string;
  readonly model: string;
  readonly row: PriceRow;
}

export interface ListedModel extends PricedModel {
  readonly freeSearchQuota: boolean;
}

export interface PriceBook {
  readonly operatorPrices: readonly PricedModel[];
  readonly anthropicTable: readonly PricedModel[];
  readonly lists: readonly ListedModel[];
}

export interface PriceQuery {
  readonly provider: string;
  readonly replyModel: string | null;
  readonly pathModel: string | null;
  readonly modelGroup: string | null;
  readonly replyCostMicros: number | null;
  readonly webSearches: number;
}

export type CallPrice =
  | {
      readonly kind: "row";
      readonly row: PriceRow;
      readonly source: "override" | "list" | "table";
    }
  | { readonly kind: "zero"; readonly source: "provider-rule" }
  | { readonly kind: "credits"; readonly source: "provider-rule" }
  | {
      readonly kind: "reply";
      readonly micros: number;
      readonly source: "reply";
    }
  | { readonly kind: "awaiting"; readonly source: "awaiting" }
  | { readonly kind: "unpriced"; readonly source: "unpriced" };

export type PriceSource = CallPrice["source"] | "replay" | "estimate";

const ANTHROPIC_TABLE_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "anthropic-oauth",
]);

export const LISTED_PROVIDERS: readonly string[] = ["ibm-litellm"];
const LISTED: ReadonlySet<string> = new Set(LISTED_PROVIDERS);

/**
 * UNIT_BOUNDARY_DESCRIPTION: the price of one call, first match wins. No
 * call takes an estimate from similar models, because a model family's
 * highest price can be several times the real one. A provider with its own
 * price list (IBM LiteLLM) prices a call by an operator price, the RITS rule,
 * the provider's list, then the proxy's own cost in the reply; a listed price
 * with a free search quota gives way to the reply's cost on a call with web
 * searches, because only the proxy knows how much of the quota is left, and
 * its names are the reply's model group, then the reply's model. Any other
 * provider prices a call by an operator price, its provider rule, then the
 * Anthropic table. A call that a provider's price sources do not price costs
 * nothing and waits for its price; a provider with no price source at all,
 * such as OpenAI without operator prices, leaves the call unpriced.
 */
export function lookupPrice(book: PriceBook, query: PriceQuery): CallPrice {
  if (LISTED.has(query.provider)) return listedPrice(book, query);
  const names = [query.pathModel, query.replyModel].filter(
    (name): name is string => !!name,
  );
  const operatorRows = book.operatorPrices.filter(
    (p) => p.provider === query.provider,
  );

  const override = matchModel(operatorRows, names);
  if (override) return { kind: "row", row: override.row, source: "override" };

  if (
    query.provider === "curve-bender" ||
    query.provider === "curve-bender-deployment"
  ) {
    return { kind: "zero", source: "provider-rule" };
  }
  if (query.provider === "bob") {
    return { kind: "credits", source: "provider-rule" };
  }

  const tableRows = ANTHROPIC_TABLE_PROVIDERS.has(query.provider)
    ? book.anthropicTable
    : [];
  const listed = matchModel(tableRows, names);
  if (listed) return { kind: "row", row: listed.row, source: "table" };

  if (operatorRows.length === 0 && tableRows.length === 0)
    return { kind: "unpriced", source: "unpriced" };
  return { kind: "awaiting", source: "awaiting" };
}

export function deployPricedProviders(book: PriceBook): string[] {
  const providers = new Set([
    ...ANTHROPIC_TABLE_PROVIDERS,
    ...book.operatorPrices.map((p) => p.provider),
  ]);
  return [...providers].filter((provider) => !LISTED.has(provider));
}

function listedPrice(book: PriceBook, query: PriceQuery): CallPrice {
  const names = [query.modelGroup, query.replyModel].filter(
    (name): name is string => !!name,
  );
  const ofProvider = <T extends PricedModel>(rows: readonly T[]) =>
    rows.filter((p) => p.provider === query.provider);

  const override = matchModel(ofProvider(book.operatorPrices), names);
  if (override) return { kind: "row", row: override.row, source: "override" };
  if (names.some((name) => name.toLowerCase().startsWith("rits/")))
    return { kind: "zero", source: "provider-rule" };

  const listed = matchModel(ofProvider(book.lists), names);
  const quotaOnReply =
    listed?.freeSearchQuota === true &&
    query.webSearches > 0 &&
    query.replyCostMicros !== null;
  if (listed && !quotaOnReply)
    return { kind: "row", row: listed.row, source: "list" };
  if (query.replyCostMicros !== null)
    return { kind: "reply", micros: query.replyCostMicros, source: "reply" };
  return { kind: "awaiting", source: "awaiting" };
}

function matchModel<T extends PricedModel>(
  rows: readonly T[],
  names: readonly string[],
): T | null {
  for (const name of names) {
    const exact = rows.filter((p) => p.model === name);
    if (exact.length > 0) return highestRow(exact);
  }
  for (const name of names) {
    const loose = rows.filter((p) => looseName(p.model) === looseName(name));
    if (loose.length > 0) return highestRow(loose);
  }
  return null;
}

function lastSegment(model: string): string {
  return (model.split("/").pop() ?? model).toLowerCase().replaceAll(".", "-");
}

function looseName(model: string): string {
  return lastSegment(model).replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, "");
}

function highestRow<T extends PricedModel>(rows: readonly T[]): T {
  return rows.reduce((best, next) =>
    next.row.prices.input > best.row.prices.input ||
    (next.row.prices.input === best.row.prices.input &&
      next.row.prices.output > best.row.prices.output)
      ? next
      : best,
  );
}

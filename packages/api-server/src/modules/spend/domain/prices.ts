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
      readonly source: "override" | "list" | "table" | "estimate";
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

export type PriceSource = CallPrice["source"] | "replay";

const ANTHROPIC_TABLE_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "anthropic-oauth",
]);

export const LISTED_PROVIDERS: readonly string[] = ["ibm-litellm"];
const LISTED: ReadonlySet<string> = new Set(LISTED_PROVIDERS);

/**
 * UNIT_BOUNDARY_DESCRIPTION: the price of one call, first match wins. A
 * provider with its own price list (IBM LiteLLM) never takes an estimate
 * from similar models: its call is priced by an operator price, the RITS
 * rule, the provider's list, then the proxy's own cost in the reply, and a
 * call that none of them prices costs nothing and waits for its price. A
 * listed price with a free search quota gives way to the reply's cost on a
 * call with web searches, because only the proxy knows how much of the quota
 * is left. Its names are the reply's model group, then the reply's model.
 * Other providers keep an estimate from their model family.
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

  const known = [...operatorRows, ...tableRows];
  if (known.length === 0) return { kind: "unpriced", source: "unpriced" };
  const families = new Set(names.map(modelFamily).filter((f) => f !== ""));
  const family = known.filter((p) => families.has(modelFamily(p.model)));
  return {
    kind: "row",
    row: highestPrices(family.length > 0 ? family : known),
    source: "estimate",
  };
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

function modelFamily(model: string): string {
  const parts = lastSegment(model).split("-");
  const firstVersion = parts.findIndex((part) => /\d/.test(part));
  return firstVersion <= 0 ? "" : parts.slice(0, firstVersion).join("-");
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

function highestPrices(rows: readonly PricedModel[]): PriceRow {
  const max = (pick: (p: PriceRow) => number | undefined) => {
    const values = rows
      .map((p) => pick(p.row))
      .filter((v): v is number => v !== undefined);
    return values.length > 0 ? Math.max(...values) : undefined;
  };
  return {
    prices: {
      input: max((r) => r.prices.input) ?? 0,
      output: max((r) => r.prices.output) ?? 0,
      cacheRead: max((r) => r.prices.cacheRead),
      cacheWrite5m: max((r) => r.prices.cacheWrite5m),
      cacheWrite1h: max((r) => r.prices.cacheWrite1h),
    },
    webSearchMicros: max((r) => r.webSearchMicros),
  };
}

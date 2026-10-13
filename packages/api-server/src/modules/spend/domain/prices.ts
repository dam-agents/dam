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

export interface TierPrices {
  readonly prices: TokenPrices;
  readonly aboveThreshold?: TokenPrices;
}

export interface PriceRow {
  readonly prices: BaseTokenPrices;
  readonly webSearchMicros?: number;
  readonly threshold?: {
    readonly promptTokens: number;
    readonly prices: TokenPrices;
  };
  readonly tiers?: Readonly<Partial<Record<ServiceTierName, TierPrices>>>;
  readonly factors?: Readonly<Record<string, number>>;
}

export interface PricedModel {
  readonly provider: string;
  readonly model: string;
  readonly row: PriceRow;
}

export interface PriceBook {
  readonly operatorPrices: readonly PricedModel[];
  readonly anthropicTable: readonly PricedModel[];
}

export interface PriceQuery {
  readonly provider: string;
  readonly replyModel: string | null;
  readonly pathModel: string | null;
}

export type CallPrice =
  | {
      readonly kind: "row";
      readonly row: PriceRow;
      readonly source: "override" | "table" | "estimate";
    }
  | { readonly kind: "zero"; readonly source: "provider-rule" }
  | { readonly kind: "credits"; readonly source: "provider-rule" }
  | { readonly kind: "unpriced"; readonly source: "unpriced" };

export type PriceSource = CallPrice["source"];

const ANTHROPIC_TABLE_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "anthropic-oauth",
]);

export function lookupPrice(book: PriceBook, query: PriceQuery): CallPrice {
  const names = [query.pathModel, query.replyModel].filter(
    (name): name is string => !!name,
  );
  const operatorRows = book.operatorPrices.filter(
    (p) => p.provider === query.provider,
  );

  const override = matchModel(operatorRows, names);
  if (override) return { kind: "row", row: override, source: "override" };

  if (query.provider === "curve-bender") {
    return { kind: "zero", source: "provider-rule" };
  }
  if (
    query.provider === "ibm-litellm" &&
    names.some((name) => name.toLowerCase().startsWith("rits/"))
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
  if (listed) return { kind: "row", row: listed, source: "table" };

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

function matchModel(
  rows: readonly PricedModel[],
  names: readonly string[],
): PriceRow | null {
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
  return lastSegment(model).replace(/-\d{8}$/, "");
}

function modelFamily(model: string): string {
  const parts = lastSegment(model).split("-");
  const firstVersion = parts.findIndex((part) => /\d/.test(part));
  return firstVersion <= 0 ? "" : parts.slice(0, firstVersion).join("-");
}

function highestRow(rows: readonly PricedModel[]): PriceRow {
  return rows.reduce((best, next) =>
    next.row.prices.input > best.row.prices.input ||
    (next.row.prices.input === best.row.prices.input &&
      next.row.prices.output > best.row.prices.output)
      ? next
      : best,
  ).row;
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

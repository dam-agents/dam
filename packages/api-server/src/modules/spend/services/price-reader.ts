import { randomUUID } from "node:crypto";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import { liteLlmPrice } from "../domain/litellm-price-row.js";
import type { PricedModel, PriceRow } from "../domain/prices.js";
import type {
  FetchedModel,
  FetchedPrices,
  PriceFetch,
} from "../infrastructure/model-info-prices.js";
import type { PriceMetrics } from "../infrastructure/price-metrics.js";
import type {
  ListedPrice,
  PriceRun,
  ProviderPriceStore,
} from "../infrastructure/provider-prices.js";

export interface PricedConnection {
  readonly connectionId: string;
  readonly provider: string;
  readonly env: Readonly<Record<string, string>>;
  credential(): Promise<string | null>;
}

export interface PricedConnections {
  list(provider: string): Promise<PricedConnection[]>;
  one(connectionId: string): Promise<PricedConnection | null>;
}

export interface PriceReader {
  readAll(provider: string): Promise<void>;
  readAllIfEmpty(provider: string): Promise<void>;
  readOne(connectionId: string): Promise<void>;
  requestRead(connectionId: string): void;
}

interface ConnectionPrices {
  readonly prices: readonly ListedPrice[];
  readonly unpriced: readonly string[];
}

const READS_AT_ONCE = 4;
const REQUESTED_READ_EVERY_MS = 5 * 60_000;
const RATE_KINDS = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite5m",
  "cacheWrite1h",
] as const;

/**
 * UNIT_BOUNDARY_DESCRIPTION: keeps one list of a provider's own prices, by
 * model group, read with the key of each of the provider's Connections. A
 * full read replaces every model it lists, and when two keys give one model
 * different prices the higher price wins. A read of one Connection only adds
 * the models that the list lacks. A refusal or an error writes the
 * Connection's status and never removes a price, so the list keeps the last
 * prices read.
 */
export function createPriceReader(deps: {
  connections: PricedConnections;
  fetch: PriceFetch;
  store: ProviderPriceStore;
  operatorPrices: readonly PricedModel[];
  metrics: PriceMetrics;
  onWritten?: (write: { readonly full: boolean }) => Promise<void>;
  now?: () => Date;
}): PriceReader {
  const log = () => getLogger();
  const now = deps.now ?? (() => new Date());
  const requestedAt = new Map<string, number>();
  const requested = new Set<string>();
  const written = async (write: { readonly full: boolean }) => {
    await deps
      .onWritten?.(write)
      .catch((err: unknown) =>
        log().warn(
          { reason: formatError(err) },
          "spend.after_price_write_failed",
        ),
      );
  };
  const newRun = (): PriceRun => ({ runId: randomUUID(), readAt: now() });

  const fetchSafely = (connection: PricedConnection): Promise<FetchedPrices> =>
    deps.fetch(connection).catch((err: unknown) => {
      log().warn(
        {
          connectionId: connection.connectionId,
          provider: connection.provider,
          reason: formatError(err),
        },
        "spend.prices_read_failed",
      );
      return { kind: "refused", status: null } as const;
    });

  const readConnection = async (
    connection: PricedConnection,
  ): Promise<ConnectionPrices | null> => {
    const { connectionId, provider } = connection;
    const result = await fetchSafely(connection);
    const at = now();
    if (result.kind === "refused") {
      await deps.store.recordRead({
        kind: "refused",
        connectionId,
        provider,
        at,
        status: result.status,
      });
      deps.metrics.priceRead({
        provider,
        outcome: result.status === null ? "error" : "refused",
      });
      log().warn(
        { connectionId, provider, status: result.status },
        "spend.prices_read",
      );
      return null;
    }
    const converted = convert(result.models);
    for (const model of result.models.filter((m) => m.conflict)) {
      log().warn(
        { connectionId, provider, model: model.model },
        "spend.price_conflict",
      );
    }
    await deps.store.recordRead({
      kind: "ok",
      connectionId,
      provider,
      at,
      modelCount: converted.prices.length,
    });
    deps.metrics.priceRead({ provider, outcome: "ok" });
    log().info(
      { connectionId, provider, status: "ok", models: converted.prices.length },
      "spend.prices_read",
    );
    return converted;
  };

  const logKept = (
    provider: string,
    prices: readonly ListedPrice[],
    unpriced: readonly string[],
  ) => {
    for (const price of prices.filter((p) => p.incomplete.length > 0)) {
      log().warn(
        { provider, model: price.model, fields: price.incomplete },
        "spend.price_incomplete",
      );
    }
    for (const model of new Set(unpriced)) {
      log().info({ provider, model }, "spend.price_missing");
    }
  };

  const checkOperatorPrices = async (provider: string) => {
    const operatorRows = deps.operatorPrices.filter(
      (p) => p.provider === provider,
    );
    if (operatorRows.length === 0) return;
    const listed = new Map(
      (await deps.store.list(provider)).map((p) => [p.model, p.row]),
    );
    for (const operator of operatorRows) {
      const row = listed.get(operator.model);
      const differences = row ? rateDifferences(operator.row, row) : [];
      if (differences.length === 0) continue;
      deps.metrics.operatorPriceDiffers({ provider, model: operator.model });
      log().warn(
        { provider, model: operator.model, differences },
        "spend.operator_price_differs",
      );
    }
  };

  const readAll = async (provider: string) => {
    const run = newRun();
    const connections = await deps.connections.list(provider);
    const results = await atMost(READS_AT_ONCE, connections, readConnection);
    const merged = new Map<string, ListedPrice>();
    for (const price of results.flatMap((r) => r?.prices ?? [])) {
      const kept = merged.get(price.model);
      if (!kept) {
        merged.set(price.model, price);
        continue;
      }
      if (JSON.stringify(kept.row) === JSON.stringify(price.row)) continue;
      const higher = pricedHigher(price.row, kept.row) ? price : kept;
      log().warn(
        {
          provider,
          model: price.model,
          kept: baseRates(higher.row),
          dropped: baseRates(higher === price ? kept.row : price.row),
        },
        "spend.price_conflict",
      );
      merged.set(price.model, higher);
    }
    const prices = [...merged.values()];
    await deps.store.put(provider, prices, run);
    if (prices.length === 0) return;
    await written({ full: true });
    logKept(
      provider,
      prices,
      results.flatMap((r) => r?.unpriced ?? []),
    );
    await checkOperatorPrices(provider);
  };

  const readOne = async (connectionId: string) => {
    const connection = await deps.connections.one(connectionId);
    if (!connection) return;
    const read = await readConnection(connection);
    if (!read) return;
    const added = new Set(
      await deps.store.addMissing(connection.provider, read.prices, newRun()),
    );
    if (read.prices.length > 0) await written({ full: false });
    logKept(
      connection.provider,
      read.prices.filter((p) => added.has(p.model)),
      read.unpriced,
    );
  };

  return {
    readAll,
    readOne,

    requestRead(connectionId) {
      const at = now().getTime();
      const last = requestedAt.get(connectionId);
      if (requested.has(connectionId)) return;
      if (last !== undefined && at - last < REQUESTED_READ_EVERY_MS) return;
      requestedAt.set(connectionId, at);
      requested.add(connectionId);
      void readOne(connectionId)
        .catch((err: unknown) =>
          log().error(
            { connectionId, reason: formatError(err) },
            "spend.requested_price_read_failed",
          ),
        )
        .finally(() => requested.delete(connectionId));
    },

    async readAllIfEmpty(provider) {
      if (await deps.store.hasAny(provider)) return;
      await readAll(provider);
    },
  };
}

function convert(models: readonly FetchedModel[]): ConnectionPrices {
  const prices: ListedPrice[] = [];
  const unpriced: string[] = [];
  for (const { model, fields } of models) {
    const price = liteLlmPrice(fields);
    if (price) prices.push({ model, ...price });
    else unpriced.push(model);
  }
  return { prices, unpriced };
}

function pricedHigher(next: PriceRow, kept: PriceRow): boolean {
  return (
    next.prices.input > kept.prices.input ||
    (next.prices.input === kept.prices.input &&
      next.prices.output > kept.prices.output)
  );
}

function baseRates(row: PriceRow): Record<string, number> {
  const input = row.prices.input;
  const cacheWrite5m = row.prices.cacheWrite5m ?? input;
  return {
    input,
    output: row.prices.output,
    cacheRead: row.prices.cacheRead ?? input,
    cacheWrite5m,
    cacheWrite1h: row.prices.cacheWrite1h ?? cacheWrite5m,
    webSearch: row.webSearchMicros ?? 0,
  };
}

function rateDifferences(
  operator: PriceRow,
  listed: PriceRow,
): { kind: string; operator: number; listed: number }[] {
  const ours = baseRates(operator);
  const theirs = baseRates(listed);
  return [...RATE_KINDS, "webSearch" as const]
    .filter((kind) => ours[kind] !== theirs[kind])
    .map((kind) => ({
      kind,
      operator: ours[kind]!,
      listed: theirs[kind]!,
    }));
}

async function atMost<T, R>(
  limit: number,
  items: readonly T[],
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, lane),
  );
  return results;
}

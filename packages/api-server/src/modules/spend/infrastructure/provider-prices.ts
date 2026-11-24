import { eq, providerModelPrices, providerPriceReads, sql, type Db } from "db";
import type { PriceRow } from "../domain/prices.js";

export interface ListedPrice {
  readonly model: string;
  readonly row: PriceRow;
  readonly freeSearchQuota: boolean;
  readonly incomplete: readonly string[];
}

export interface PriceRun {
  readonly runId: string;
  readonly readAt: Date;
}

export type PriceRead =
  | {
      readonly kind: "ok";
      readonly connectionId: string;
      readonly provider: string;
      readonly at: Date;
      readonly modelCount: number;
    }
  | {
      readonly kind: "refused";
      readonly connectionId: string;
      readonly provider: string;
      readonly at: Date;
      readonly status: number | null;
    };

export interface ProviderPriceStore {
  list(provider: string): Promise<ListedPrice[]>;
  hasAny(provider: string): Promise<boolean>;
  put(
    provider: string,
    prices: readonly ListedPrice[],
    run: PriceRun,
  ): Promise<void>;
  addMissing(
    provider: string,
    prices: readonly ListedPrice[],
    run: PriceRun,
  ): Promise<string[]>;
  recordRead(read: PriceRead): Promise<void>;
}

export function createProviderPriceStore(db: Db): ProviderPriceStore {
  const rowsOf = (
    provider: string,
    prices: readonly ListedPrice[],
    run: PriceRun,
  ) =>
    prices.map((price) => ({
      provider,
      model: price.model,
      row: price.row,
      freeSearchQuota: price.freeSearchQuota,
      incomplete: [...price.incomplete],
      runId: run.runId,
      readAt: run.readAt,
    }));

  return {
    async list(provider) {
      const rows = await db
        .select({
          model: providerModelPrices.model,
          row: providerModelPrices.row,
          freeSearchQuota: providerModelPrices.freeSearchQuota,
          incomplete: providerModelPrices.incomplete,
        })
        .from(providerModelPrices)
        .where(eq(providerModelPrices.provider, provider));
      return rows.map((r) => ({ ...r, row: r.row as PriceRow }));
    },

    async hasAny(provider) {
      const rows = await db
        .select({ model: providerModelPrices.model })
        .from(providerModelPrices)
        .where(eq(providerModelPrices.provider, provider))
        .limit(1);
      return rows.length > 0;
    },

    async put(provider, prices, run) {
      if (prices.length === 0) return;
      await db
        .insert(providerModelPrices)
        .values(rowsOf(provider, prices, run))
        .onConflictDoUpdate({
          target: [providerModelPrices.provider, providerModelPrices.model],
          set: {
            row: sql`excluded.row`,
            freeSearchQuota: sql`excluded.free_search_quota`,
            incomplete: sql`excluded.incomplete`,
            runId: sql`excluded.run_id`,
            readAt: sql`excluded.read_at`,
          },
        });
    },

    async addMissing(provider, prices, run) {
      if (prices.length === 0) return [];
      const added = await db
        .insert(providerModelPrices)
        .values(rowsOf(provider, prices, run))
        .onConflictDoNothing()
        .returning({ model: providerModelPrices.model });
      return added.map((r) => r.model);
    },

    async recordRead(read) {
      const outcome =
        read.kind === "ok"
          ? { lastOkAt: read.at, modelCount: read.modelCount }
          : { lastRefusedAt: read.at, lastStatus: read.status };
      await db
        .insert(providerPriceReads)
        .values({
          connectionId: read.connectionId,
          provider: read.provider,
          ...outcome,
        })
        .onConflictDoUpdate({
          target: providerPriceReads.connectionId,
          set: { provider: read.provider, ...outcome },
        });
    },
  };
}

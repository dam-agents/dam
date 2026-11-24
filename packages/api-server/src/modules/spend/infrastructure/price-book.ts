import type { ListedModel, PriceBook } from "../domain/prices.js";
import type { ProviderPriceStore } from "./provider-prices.js";

export interface LivePriceBook {
  current(): PriceBook;
  reload(): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: each replica's copy of the price book. The
 * operator prices and the Anthropic table are fixed at start; the providers'
 * own price lists come from Postgres and are replaced on each reload, so the
 * meter prices every record synchronously from memory while the lists change
 * underneath it.
 */
export function createLivePriceBook(deps: {
  fixed: Omit<PriceBook, "lists">;
  store: ProviderPriceStore;
  providers: readonly string[];
}): LivePriceBook {
  let book: PriceBook = { ...deps.fixed, lists: [] };
  return {
    current: () => book,
    async reload() {
      const lists = await Promise.all(
        deps.providers.map(async (provider): Promise<ListedModel[]> =>
          (await deps.store.list(provider)).map((price) => ({
            provider,
            model: price.model,
            row: price.row,
            freeSearchQuota: price.freeSearchQuota,
          })),
        ),
      );
      book = { ...deps.fixed, lists: lists.flat() };
    },
  };
}

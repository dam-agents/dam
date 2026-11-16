import {
  createModelDiscovery,
  priceListingForTemplate,
  type ModelDiscovery,
} from "api-server-api";
import { getLogger } from "../../../core/logger.js";

export interface PriceSource {
  readonly provider: string;
  readonly env: Readonly<Record<string, string>>;
  credential(): Promise<string | null>;
}

export interface FetchedModel {
  readonly model: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly conflict: boolean;
}

export type FetchedPrices =
  | { readonly kind: "ok"; readonly models: readonly FetchedModel[] }
  | { readonly kind: "refused"; readonly status: number | null };

export type PriceFetch = (source: PriceSource) => Promise<FetchedPrices>;

export function hasPriceListing(provider: string): boolean {
  return priceListingForTemplate(provider) !== null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: reads a provider's own price list with one
 * Connection's key, through the same model discovery that lists the
 * catalogs. The key goes only into the request's credential headers, and the
 * discovery keeps only each model's price fields, never its deployment
 * settings, so neither reaches a row or a log line.
 */
export function createModelInfoPriceFetch(
  deps: { discover?: ModelDiscovery } = {},
): PriceFetch {
  const discover =
    deps.discover ??
    createModelDiscovery({ log: (message) => getLogger().info(message) });
  return async (source) => {
    const listing = priceListingForTemplate(source.provider);
    const credential = listing ? await source.credential() : null;
    if (!listing || !credential) return { kind: "refused", status: null };
    const env = { ...source.env };
    for (const name of listing.spec.tokenEnv ?? []) env[name] = credential;
    const outcome = await discover(listing.spec, env);
    if (outcome.status !== "observed") {
      return {
        kind: "refused",
        status:
          outcome.status === "unavailable"
            ? (outcome.httpStatus ?? null)
            : null,
      };
    }
    return {
      kind: "ok",
      models: (outcome.entries ?? []).map((entry) => ({
        model: entry.id,
        fields: entry.info?.priceFields ?? {},
        conflict: entry.priceConflict ?? false,
      })),
    };
  };
}

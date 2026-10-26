import {
  aliasForTemplateId,
  createModelDiscovery,
  displayNameForTemplate,
  harnessFits,
  layerMetadata,
  listingForTemplate,
  MIN_CONTEXT_WINDOW,
  PROVIDER_DIALECTS,
  providerTypeForTemplateId,
  renderName,
  type CatalogEntry,
  type ProviderListingStatus,
  type Connection,
  type DiscoveredModel,
  type HarnessCatalog,
  type ModelDiscovery,
  type OwnerModelCatalogView,
  type PriceTable,
  type ProviderCatalogView,
  type ProviderListingSpec,
} from "api-server-api";
import { VENDORED_PRICE_TABLE } from "api-server-api/model-prices";
import { getLogger } from "../../../core/logger.js";
import type { SecretStore } from "../../secret-store/index.js";

const REFRESH_MS = 30 * 60_000;

interface KeptListing {
  status: ProviderListingStatus;
  listedAt: string | null;
  entries: CatalogEntry[];
  fetchedAt: number;
}

export interface ProviderModelCatalog {
  read(
    connections: readonly Connection[],
    harnesses: Pick<HarnessCatalog, "default" | "harnesses">,
  ): Promise<OwnerModelCatalogView>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's provider Connections listed without
 * an agent, from the same listing specs and metadata layers the runtime uses.
 * The credential comes from the secret store and stays inside the request; a
 * failed listing keeps the Connection's last good list so an outage hides
 * nothing that was known.
 */
export function createProviderModelCatalog(deps: {
  secretStore: SecretStore;
  discover?: ModelDiscovery;
  table?: PriceTable;
  now?: () => Date;
  refreshMs?: number;
}): ProviderModelCatalog {
  const discover = deps.discover ?? createModelDiscovery({ log: logListing });
  const table = deps.table ?? VENDORED_PRICE_TABLE;
  const now = deps.now ?? (() => new Date());
  const refreshMs = deps.refreshMs ?? REFRESH_MS;
  const kept = new Map<string, KeptListing>();
  const inFlight = new Map<string, Promise<void>>();

  function logListing(message: string): void {
    getLogger().info(message);
  }

  const envOf = (connection: Connection): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const contribution of connection.contributions) {
      if (contribution.kind === "env")
        env[contribution.name] = contribution.placeholder;
    }
    return env;
  };

  const list = async (
    connection: Connection,
    listing: ProviderListingSpec,
  ): Promise<void> => {
    const previous = kept.get(connection.id);
    const presetEnv = envOf(connection);
    const env = { ...presetEnv };
    const urlVar = listing.spec.urlEnv[0]!;
    if (!env[urlVar] && listing.defaultBase) env[urlVar] = listing.defaultBase;
    const credential =
      connection.auth.kind === "header"
        ? await deps.secretStore.getField(connection.auth.valueRef)
        : null;
    if (!credential) {
      kept.set(connection.id, {
        status: "unavailable",
        listedAt: previous?.listedAt ?? null,
        entries: previous?.entries ?? [],
        fetchedAt: now().getTime(),
      });
      return;
    }
    for (const name of listing.spec.tokenEnv ?? []) env[name] = credential;
    const alias = aliasForTemplateId(connection.templateId)!;
    const outcome = await discover(listing.spec, env);
    if (outcome.status !== "observed") {
      logListing(
        `[provider-catalog] ${connection.templateId} (${connection.id}): listing ${outcome.status}${previous?.entries.length ? `; keeping ${previous.entries.length} known model(s)` : ""}`,
      );
      kept.set(connection.id, {
        status: "unavailable",
        listedAt: previous?.listedAt ?? null,
        entries: previous?.entries ?? [],
        fetchedAt: now().getTime(),
      });
      return;
    }
    const discovered: DiscoveredModel[] =
      outcome.entries ??
      outcome.models.map((m) => ({ id: m.value, name: m.value }));
    const entries: CatalogEntry[] = discovered
      .filter((m) => listing.keep?.(m.id) ?? true)
      .map((m) => ({
        name: renderName({ alias, upstreamId: m.id }, undefined),
        alias,
        connectionId: connection.id,
        template: connection.templateId,
        upstreamId: m.id,
        dialects: PROVIDER_DIALECTS[alias],
        metadata: layerMetadata({
          upstreamId: m.id,
          provider: listing.prices
            ? { ...m.info, prices: listing.prices }
            : (m.info ?? null),
          table,
          presetEnv,
        }),
      }));
    kept.set(connection.id, {
      status: "listed",
      listedAt: now().toISOString(),
      entries,
      fetchedAt: now().getTime(),
    });
  };

  const ensure = (
    connection: Connection,
    listing: ProviderListingSpec,
  ): Promise<void> => {
    const running = inFlight.get(connection.id);
    if (running) return running;
    const started = list(connection, listing)
      .catch((err: unknown) =>
        getLogger().warn(
          { reason: (err as Error).message, connectionId: connection.id },
          "provider catalog listing failed",
        ),
      )
      .finally(() => inFlight.delete(connection.id));
    inFlight.set(connection.id, started);
    return started;
  };

  return {
    async read(connections, harnesses) {
      const live = new Set(connections.map((c) => c.id));
      for (const id of kept.keys()) if (!live.has(id)) kept.delete(id);
      const current = now().getTime();
      const providers = await Promise.all(
        connections.map(
          async (connection): Promise<ProviderCatalogView | null> => {
            const type = providerTypeForTemplateId(connection.templateId);
            const alias = aliasForTemplateId(connection.templateId);
            if (!type || !alias) return null;
            const base = {
              connectionId: connection.id,
              alias,
              template: connection.templateId,
              displayName:
                displayNameForTemplate(connection.templateId) ??
                connection.name,
              harnesses: harnesses.harnesses
                .filter((h) =>
                  harnessFits(harnesses, h.name, type, connection.templateId),
                )
                .map((h) => h.name),
            };
            const listing = listingForTemplate(connection.templateId);
            if (!listing)
              return {
                ...base,
                status: "unsupported",
                listedAt: null,
                models: [],
              };
            const cached = kept.get(connection.id);
            if (!cached) await ensure(connection, listing);
            else if (current - cached.fetchedAt > refreshMs)
              void ensure(connection, listing);
            const known = kept.get(connection.id);
            const entries = known?.entries ?? [];
            return {
              ...base,
              status: known?.status ?? "unavailable",
              listedAt: known?.listedAt ?? null,
              models: entries.map((entry) => ({
                name: entry.name,
                upstreamId: entry.upstreamId,
                contextWindow: entry.metadata.contextWindow,
                maxOutputTokens: entry.metadata.maxOutputTokens,
                reasoning: entry.metadata.reasoning,
                vision: entry.metadata.vision,
                prices: entry.metadata.prices,
                source: entry.metadata.source,
                harnesses:
                  entry.metadata.contextWindow === null ||
                  entry.metadata.contextWindow >= MIN_CONTEXT_WINDOW
                    ? base.harnesses
                    : [],
              })),
            };
          },
        ),
      );
      return { providers: providers.filter((p) => p !== null) };
    },
  };
}

import {
  aliasForTemplateId,
  createModelDiscovery,
  displayNameForTemplate,
  harnessFits,
  layerMetadata,
  listingForTemplate,
  MIN_CONTEXT_WINDOW,
  nativeListingForTemplate,
  nativePinOf,
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
  withNativePin,
} from "api-server-api";
import { VENDORED_PRICE_TABLE } from "api-server-api/model-prices";
import { getLogger } from "../../../core/logger.js";
import type { SecretStore } from "../../secret-store/index.js";
import {
  harnessCapabilityOf,
  loadShippedHarnessFacts,
  type ShippedHarnessFacts,
} from "../infrastructure/shipped-harness-manifests.js";

const REFRESH_MS = 30 * 60_000;
const FAILED_REFRESH_MS = 10_000;

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
  shipped?: Record<string, ShippedHarnessFacts>;
}): ProviderModelCatalog {
  const discover = deps.discover ?? createModelDiscovery({ log: logListing });
  const table = deps.table ?? VENDORED_PRICE_TABLE;
  const now = deps.now ?? (() => new Date());
  const refreshMs = deps.refreshMs ?? REFRESH_MS;
  const shipped = deps.shipped ?? loadShippedHarnessFacts();
  /* UNIT_BOUNDARY_DESCRIPTION: shared by every owner and keyed by Connection id, so one owner's read never evicts another's lists. A deleted Connection's entry stays until the process restarts: a few KB per Connection ever listed. */
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

  /**
   * UNIT_BOUNDARY_DESCRIPTION: what a Connection the router never fronts
   * offers each harness that runs it natively: the harness's own names for
   * its models, or, for a harness that takes them from the Connection, the
   * models the Connection lists (`listedBy`).
   */
  const nativeModels = (
    template: string,
    harnessNames: readonly string[],
  ): {
    named: { upstreamId: string; harnesses: string[] }[];
    listedBy: string[];
  } => {
    const byModel = new Map<string, string[]>();
    const listedBy: string[] = [];
    for (const harness of harnessNames) {
      const native = shipped[harness]?.native;
      if (!native?.templates.includes(template)) continue;
      if (native.models === "listed") {
        listedBy.push(harness);
        continue;
      }
      for (const upstreamId of native.models) {
        byModel.set(upstreamId, [...(byModel.get(upstreamId) ?? []), harness]);
      }
    }
    return {
      named: [...byModel].map(([upstreamId, harnesses]) => ({
        upstreamId,
        harnesses,
      })),
      listedBy,
    };
  };

  const listed = async (
    connection: Connection,
    listing: ProviderListingSpec,
    current: number,
  ): Promise<KeptListing | undefined> => {
    const cached = kept.get(connection.id);
    if (!cached) await ensure(connection, listing);
    else if (
      current - cached.fetchedAt >
      (cached.status === "unavailable" ? FAILED_REFRESH_MS : refreshMs)
    )
      void ensure(connection, listing);
    return kept.get(connection.id);
  };

  return {
    async read(connections, harnesses) {
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
            if (!listing) {
              const { named, listedBy } = nativeModels(
                connection.templateId,
                base.harnesses,
              );
              const spec = nativeListingForTemplate(connection.templateId);
              const known =
                listedBy.length > 0 && spec
                  ? await listed(connection, { spec }, current)
                  : undefined;
              const models = new Map(
                named.map((m) => [m.upstreamId, m.harnesses]),
              );
              const pin =
                listedBy.length > 0
                  ? nativePinOf(connection.templateId, envOf(connection))
                  : null;
              for (const upstreamId of withNativePin(
                (known?.entries ?? []).map((e) => e.upstreamId),
                pin,
              ))
                models.set(upstreamId, [
                  ...(models.get(upstreamId) ?? []),
                  ...listedBy,
                ]);
              if (named.length === 0 && listedBy.length === 0)
                return {
                  ...base,
                  status: "unsupported",
                  listedAt: null,
                  models: [],
                };
              return {
                ...base,
                status:
                  named.length > 0 || pin
                    ? "listed"
                    : (known?.status ?? "unavailable"),
                listedAt: known?.listedAt ?? null,
                models: [...models].map(([upstreamId, modelHarnesses]) => ({
                  name: renderName({ alias, upstreamId }, undefined),
                  upstreamId,
                  contextWindow: null,
                  maxOutputTokens: null,
                  reasoning: null,
                  vision: null,
                  prices: null,
                  source: { limits: "none", prices: "none" },
                  harnesses: modelHarnesses,
                })),
              };
            }
            const known = await listed(connection, listing, current);
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
      const capabilities = harnesses.harnesses.map((h) => {
        const facts = shipped[h.name];
        return (
          (facts && harnessCapabilityOf(facts)) || {
            name: h.name,
            harnessConfig: false,
            sessionModel: false,
          }
        );
      });
      return {
        defaultHarness: harnesses.default,
        modelRouter:
          capabilities.length > 0 &&
          harnesses.harnesses.every(
            (h) => shipped[h.name]?.modelRouter === true,
          ),
        harnesses: capabilities,
        providers: providers.filter((p) => p !== null),
      };
    },
  };
}

import {
  aliasForTemplateId,
  displayNameForTemplate,
  providerTypeForTemplateId,
  parseQualifiedModel,
} from "api-server-api";
import type {
  CatalogModelView,
  CatalogProviderView,
  HarnessCatalogView,
} from "agent-runtime-api";
import type { ModelRouterBinding } from "../../runtime-channel/manifest.js";
import type { RuntimeEnvState } from "../../runtime-channel/infrastructure/env-state-store.js";
import type {
  DiscoveredModel,
  ModelDiscovery,
} from "../../runtime-channel/infrastructure/model-discovery.js";
import type { CatalogEntry, CatalogProvider } from "../domain/catalog-entry.js";
import { layerMetadata } from "../domain/metadata.js";
import type { PriceTable } from "../domain/price-table.js";
import {
  listingForTemplate,
  PROVIDER_DIALECTS,
} from "../domain/provider-listing.js";
import { forHarness, renderName, servesHarness } from "../domain/render.js";

const REFRESH_MS = 30 * 60_000;
const RETRY_INITIAL_MS = 2_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface ModelCatalog {
  providers(): CatalogProvider[];
  entries(): CatalogEntry[];
  forHarness(harness: string): CatalogEntry[];
  resolve(name: string, harness?: string): CatalogEntry | null;
  view(harness: string): HarnessCatalogView;
  listed(): Promise<void>;
  refresh(): Promise<void>;
  onChange(listener: () => void): () => void;
  start(): void;
  stop(): void;
}

export interface ModelCatalogDeps {
  envState: () => RuntimeEnvState;
  envReady: () => boolean;
  discover: ModelDiscovery;
  harnesses: Readonly<Record<string, ModelRouterBinding | undefined>>;
  table: PriceTable;
  log: (msg: string) => void;
  refreshMs?: number;
  retryMs?: { initial: number; max: number };
  now?: () => Date;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one list of models an Agent can run, built
 * per granted provider Connection, which the Model Router routes by, the
 * harness catalogs and the picker are rendered from, and spend is priced by.
 * A listing that fails keeps the Connection's last good list, so a provider
 * outage hides nothing that was known.
 */
export function createModelCatalog(deps: ModelCatalogDeps): ModelCatalog {
  const now = deps.now ?? (() => new Date());
  const retryMs = deps.retryMs ?? {
    initial: RETRY_INITIAL_MS,
    max: RETRY_MAX_MS,
  };
  let providers: CatalogProvider[] = [];
  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;
  let again = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = retryMs.initial;

  /**
   * UNIT_BOUNDARY_DESCRIPTION: what is known of a provider Connection from
   * its env layer alone, before any listing: enough for a harness process
   * spawned on a fresh pod to be pointed at the router (the env rail and the
   * first trigger arrive together, ahead of the first listing).
   */
  const describe = (layer: RuntimeEnvState["providers"][number]) => {
    const template = layer.template ?? "";
    const alias = aliasForTemplateId(template);
    const type = providerTypeForTemplateId(template);
    const listing = listingForTemplate(template);
    const base = {
      connectionId: layer.id,
      template,
      alias: alias ?? ("ibm" as const),
      displayName:
        layer.env.PLATFORM_LLM_NAME ??
        (displayNameForTemplate(template) || template || layer.id),
      dialects: alias ? PROVIDER_DIALECTS[alias] : [],
      ...(listing?.harnesses && { harnesses: listing.harnesses }),
    };
    const supported =
      !!alias && !!type && !!listing && base.dialects.length > 0;
    return { base, alias, listing, supported };
  };

  const unlisted = (
    layer: RuntimeEnvState["providers"][number],
  ): CatalogProvider => {
    const { base, supported } = describe(layer);
    return {
      ...base,
      status: supported ? "unavailable" : "unsupported",
      listedAt: null,
      entries: [],
    };
  };

  const listProvider = async (
    layer: RuntimeEnvState["providers"][number],
    previous: CatalogProvider | undefined,
  ): Promise<CatalogProvider> => {
    const { base, alias, listing, supported } = describe(layer);
    if (!supported || !alias || !listing) return unlisted(layer);
    const env = {
      ...(listing.defaultBase && {
        [listing.spec.urlEnv[0]]: listing.defaultBase,
      }),
      ...layer.env,
    };
    const outcome = await deps.discover(listing.spec, env);
    if (outcome.status !== "observed") {
      deps.log(
        `[model-catalog] ${alias} (${layer.id}): listing ${outcome.status}${previous?.entries.length ? `; keeping ${previous.entries.length} known model(s)` : ""}`,
      );
      return {
        ...base,
        status: "unavailable",
        listedAt: previous?.listedAt ?? null,
        entries: previous?.entries ?? [],
      };
    }
    const discovered: DiscoveredModel[] =
      outcome.entries ??
      outcome.models.map((m) => ({ id: m.value, name: m.value }));
    const entries: CatalogEntry[] = discovered
      .filter((m) => listing.keep?.(m.id) ?? true)
      .map((m) => ({
        name: renderName({ alias, upstreamId: m.id }, undefined),
        alias,
        connectionId: layer.id,
        template: base.template,
        upstreamId: m.id,
        dialects: base.dialects,
        ...(base.harnesses && { harnesses: base.harnesses }),
        metadata: layerMetadata({
          upstreamId: m.id,
          provider: listing.prices
            ? { ...m.info, prices: listing.prices }
            : (m.info ?? null),
          table: deps.table,
          presetEnv: layer.env,
        }),
      }));
    deps.log(
      `[model-catalog] ${alias} (${layer.id}): ${entries.length} model(s)`,
    );
    return {
      ...base,
      status: "listed",
      listedAt: now().toISOString(),
      entries,
    };
  };

  let markListed: () => void = () => {};
  const firstListing = new Promise<void>((resolve) => {
    markListed = resolve;
  });

  const rebuild = async (): Promise<void> => {
    if (!deps.envReady()) return;
    const state = deps.envState();
    const known = new Map(providers.map((p) => [p.connectionId, p]));
    const next = await Promise.all(
      state.providers.map((layer) => listProvider(layer, known.get(layer.id))),
    );
    const before = JSON.stringify(
      providers.map((p) => [
        p.connectionId,
        p.status,
        p.entries.map((e) => e.name),
      ]),
    );
    providers = next;
    markListed();
    const after = JSON.stringify(
      providers.map((p) => [
        p.connectionId,
        p.status,
        p.entries.map((e) => e.name),
      ]),
    );
    if (before !== after) for (const listener of listeners) listener();
    scheduleRetry();
  };

  const scheduleRetry = (): void => {
    const unavailable = providers.some((p) => p.status === "unavailable");
    if (retry) {
      clearTimeout(retry);
      retry = null;
    }
    if (!unavailable || timer === null) {
      retryDelay = retryMs.initial;
      return;
    }
    retry = setTimeout(() => {
      retry = null;
      void run();
    }, retryDelay);
    retry.unref?.();
    retryDelay = Math.min(retryDelay * 2, retryMs.max);
  };

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a refresh asked from outside follows a change
   * (a grant reaching the pod, which also restarts the agent's egress
   * gateway), so its failures retry from the shortest delay again.
   */
  const refresh = (): Promise<void> => {
    retryDelay = retryMs.initial;
    return run();
  };

  const run = (): Promise<void> => {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      do {
        again = false;
        try {
          await rebuild();
        } catch (err) {
          deps.log(`[model-catalog] rebuild failed: ${(err as Error).message}`);
        }
      } while (again);
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const entries = (): CatalogEntry[] => providers.flatMap((p) => p.entries);

  const modelView = (e: CatalogEntry): CatalogModelView => ({
    name: e.name,
    upstreamId: e.upstreamId,
    contextWindow: e.metadata.contextWindow,
    maxOutputTokens: e.metadata.maxOutputTokens,
    reasoning: e.metadata.reasoning,
    vision: e.metadata.vision,
    prices: e.metadata.prices,
    source: e.metadata.source,
  });

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a model the harness runs natively on a
   * Connection the router never fronts is offered and validated like any
   * catalog model, but it is not a catalog entry, so the router can never
   * route it.
   */
  const nativeModelView = (
    alias: CatalogEntry["alias"],
    upstreamId: string,
    binding: ModelRouterBinding | undefined,
  ): CatalogModelView => ({
    name: renderName({ alias, upstreamId }, binding),
    upstreamId,
    contextWindow: null,
    maxOutputTokens: null,
    reasoning: null,
    vision: null,
    prices: null,
    source: { limits: "none", prices: "none" },
  });

  const withPending = (): CatalogProvider[] => {
    if (!deps.envReady()) return providers;
    const known = new Set(providers.map((p) => p.connectionId));
    const pending = deps
      .envState()
      .providers.filter((l) => !known.has(l.id))
      .map(unlisted);
    return pending.length > 0 ? [...providers, ...pending] : providers;
  };

  return {
    providers: withPending,
    listed: () => firstListing,
    entries,
    forHarness: (harness) =>
      forHarness(entries(), harness, deps.harnesses[harness]),
    resolve: (name, harness) => {
      const binding = harness ? deps.harnesses[harness] : undefined;
      const parsed = parseQualifiedModel(name, {
        claudePrefix: binding?.namePrefix === "claude/",
      });
      if (!parsed) return null;
      const wanted = parsed.upstreamId.toLowerCase();
      return (
        entries().find(
          (e) => e.alias === parsed.alias && e.upstreamId === parsed.upstreamId,
        ) ??
        entries().find(
          (e) =>
            e.alias === parsed.alias && e.upstreamId.toLowerCase() === wanted,
        ) ??
        null
      );
    },
    view: (harness): HarnessCatalogView => {
      const binding = deps.harnesses[harness];
      return {
        harness,
        routed: binding !== undefined,
        providers: withPending().map((p): CatalogProviderView => {
          const native = binding?.native?.templates.includes(p.template)
            ? binding.native.models
            : null;
          return {
            connectionId: p.connectionId,
            alias: p.alias,
            template: p.template,
            displayName: p.displayName,
            status: native
              ? "listed"
              : binding && !servesHarness(p, harness, binding)
                ? "unsupported"
                : p.status,
            listedAt: p.listedAt,
            native: native !== null,
            models: native
              ? native.map((id) => nativeModelView(p.alias, id, binding))
              : forHarness(p.entries, harness, binding).map(modelView),
          };
        }),
      };
    },
    refresh,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => {
      if (timer) return;
      timer = setInterval(() => void run(), deps.refreshMs ?? REFRESH_MS);
      timer.unref?.();
      scheduleRetry();
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
      if (retry) clearTimeout(retry);
      retry = null;
    },
  };
}

import {
  aliasForTemplateId,
  displayNameForTemplate,
  forHarness,
  layerMetadata,
  listingForTemplate,
  modelDialect,
  nativeListingForTemplate,
  nativePinOf,
  parseQualifiedModel,
  PROVIDER_ALIASES,
  PROVIDER_DIALECTS,
  providerTypeForTemplateId,
  renderName,
  servesHarness,
  withNativePin,
  type CatalogEntry,
  type CatalogProvider,
  type DiscoveredModel,
  type ModelDiscovery,
  type PriceTable,
  type ProviderListingStatus,
} from "api-server-api";
import { z } from "zod";
import { join } from "node:path";
import type {
  CatalogModelView,
  CatalogProviderView,
  HarnessCatalogView,
} from "agent-runtime-api";
import { openJsonFile } from "../../../core/document-store.js";
import type { ModelRouterBinding } from "../../runtime-channel/manifest.js";
import type { RuntimeEnvState } from "../../runtime-channel/infrastructure/env-state-store.js";

const REFRESH_MS = 30 * 60_000;
const RETRY_INITIAL_MS = 2_000;
const RETRY_MAX_MS = 5 * 60_000;
const CACHE_MAX_BYTES = 8 * 1024 * 1024;

interface NativeListing {
  status: ProviderListingStatus;
  listedAt: string | null;
  ids: string[];
  failed: boolean;
}

const listingStatus = z.enum(["listed", "unavailable", "unsupported"]);
const metadataSource = z.enum(["provider", "table", "known", "preset", "none"]);

const cachedCatalog = z.object({
  version: z.literal(1),
  providers: z.array(
    z.object({
      connectionId: z.string(),
      alias: z.enum(PROVIDER_ALIASES),
      template: z.string(),
      displayName: z.string(),
      dialects: z.array(modelDialect),
      harnesses: z.array(z.string()).optional(),
      status: listingStatus,
      listedAt: z.string().nullable(),
      entries: z.array(
        z.object({
          name: z.string(),
          alias: z.enum(PROVIDER_ALIASES),
          connectionId: z.string(),
          template: z.string(),
          upstreamId: z.string(),
          dialects: z.array(modelDialect),
          harnesses: z.array(z.string()).optional(),
          metadata: z.object({
            contextWindow: z.number().nullable(),
            maxOutputTokens: z.number().nullable(),
            reasoning: z.boolean().nullable(),
            vision: z.boolean().nullable(),
            cacheControl: z.literal("anthropic").nullable(),
            thinkingFormat: z.literal("zai").nullable(),
            prices: z
              .object({
                inputPerToken: z.number(),
                outputPerToken: z.number(),
                cacheReadPerToken: z.number().nullable(),
                cacheWritePerToken: z.number().nullable(),
              })
              .nullable(),
            source: z.object({
              limits: metadataSource,
              prices: metadataSource,
            }),
          }),
        }),
      ),
    }),
  ),
  native: z.record(
    z.string(),
    z.object({
      status: listingStatus,
      listedAt: z.string().nullable(),
      ids: z.array(z.string()),
      failed: z.boolean(),
    }),
  ),
});

interface CatalogCache {
  version: 1;
  providers: CatalogProvider[];
  native: Record<string, NativeListing>;
}

export interface ModelCatalog {
  providers(): CatalogProvider[];
  entries(): CatalogEntry[];
  forHarness(harness: string): CatalogEntry[];
  resolve(name: string, harness?: string): CatalogEntry | null;
  view(harness: string): HarnessCatalogView;
  listed(): Promise<void>;
  settled(): Promise<void>;
  refresh(): Promise<void>;
  refreshForEnvChange(): Promise<void>;
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
  cachePath?: string;
  refreshMs?: number;
  retryMs?: { initial: number; max: number };
  now?: () => Date;
}

export function modelCatalogCachePath(agentHome: string): string {
  return join(agentHome, ".platform", "model-catalog.json");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one list of models an Agent can run, built
 * per granted provider Connection, which the Model Router routes by, the
 * harness catalogs and the picker are rendered from, and spend is priced by.
 * A listing that fails keeps the Connection's last good list, so a provider
 * outage hides nothing that was known. The list the agent last routed on is
 * kept on its home volume as a versioned document whose schema restates these
 * types, so a cache another shape wrote is dropped rather than trusted, and a
 * boot whose env rail is already there restores it for the Connections the env
 * still grants: the default harness reads its models and their windows at
 * listen instead of after discovery through a gateway pod that is still coming
 * up. The rebuild that follows replaces it, and the listeners hear only about
 * what a reader or a harness reads at spawn — a model's name and window, a
 * provider's status — never a listing time, so a rebuild that finds the
 * restored catalog unchanged notifies nobody. A rebuild an env change starts
 * holds the harness that change recycles until it lands, so one boot settles
 * into one harness.
 */
export function createModelCatalog(deps: ModelCatalogDeps): ModelCatalog {
  const now = deps.now ?? (() => new Date());
  const retryMs = deps.retryMs ?? {
    initial: RETRY_INITIAL_MS,
    max: RETRY_MAX_MS,
  };
  let providers: CatalogProvider[] = [];
  let native = new Map<string, NativeListing>();
  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;
  let again = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = retryMs.initial;
  const cache =
    deps.cachePath === undefined
      ? null
      : openJsonFile<CatalogCache | null>(deps.cachePath, {
          schema: cachedCatalog.nullable(),
          initial: () => null,
          maxBytes: CACHE_MAX_BYTES,
        });
  let cachedPrint: string | null = null;

  /**
   * UNIT_BOUNDARY_DESCRIPTION: what is known of a provider Connection from
   * its env layer alone, before any listing: enough for a harness process
   * spawned on a fresh machine to be pointed at the router (the env rail and the
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
      displayName: displayNameForTemplate(template) || template || layer.id,
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

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a Connection the router never fronts is listed
   * only for a harness that runs it natively on the models it lists (Pi on
   * Bedrock); a harness that names its own models there needs no listing. A
   * failed listing keeps the last good one, and with a pinned model counts as
   * listed, since the pin runs whether or not the key may list.
   */
  const nativeListingOf = (template: string) =>
    Object.values(deps.harnesses).some(
      (b) =>
        b?.native?.models === "listed" && b.native.templates.includes(template),
    )
      ? nativeListingForTemplate(template)
      : null;

  const listNative = async (
    layer: RuntimeEnvState["providers"][number],
    previous: NativeListing | undefined,
  ): Promise<NativeListing | null> => {
    const listing = nativeListingOf(layer.template ?? "");
    if (!listing) return null;
    const pin = nativePinOf(layer.template ?? "", layer.env);
    const outcome = await deps.discover(listing.spec, layer.env);
    if (outcome.status !== "observed") {
      deps.log(
        `[model-catalog] ${layer.template} (${layer.id}): native listing ${outcome.status}${previous?.ids.length ? `; keeping ${previous.ids.length} known model(s)` : ""}`,
      );
      return {
        status: pin ? "listed" : "unavailable",
        listedAt: previous?.listedAt ?? null,
        ids: withNativePin(previous?.ids ?? [], pin),
        failed: outcome.status === "unavailable",
      };
    }
    const ids = (
      outcome.entries ?? outcome.models.map((m) => ({ id: m.value }))
    )
      .map((m) => m.id)
      .filter((id) => listing.keep?.(id) ?? true);
    deps.log(
      `[model-catalog] ${layer.template} (${layer.id}): ${ids.length} native model(s)`,
    );
    return {
      status: "listed",
      listedAt: now().toISOString(),
      ids: withNativePin(ids, pin),
      failed: false,
    };
  };

  let markListed: () => void = () => {};
  const firstListing = new Promise<void>((resolve) => {
    markListed = resolve;
  });
  let spawnGate: Promise<void> | null = null;

  const cacheDocument = (): CatalogCache => ({
    version: 1,
    providers,
    native: Object.fromEntries(native),
  });

  const restore = (): void => {
    const cached = cache?.read();
    if (!cached || !deps.envReady()) return;
    const granted = new Set(deps.envState().providers.map((l) => l.id));
    providers = cached.providers.filter((p) => granted.has(p.connectionId));
    native = new Map(
      Object.entries(cached.native).filter(([id]) => granted.has(id)),
    );
    cachedPrint = JSON.stringify(cacheDocument());
    markListed();
  };

  const writeCache = (): void => {
    if (!cache) return;
    const document = cacheDocument();
    const print = JSON.stringify(document);
    if (print === cachedPrint || print.length > CACHE_MAX_BYTES) return;
    cachedPrint = print;
    try {
      cache.write(document);
    } catch (err) {
      deps.log(
        `[model-catalog] catalog not kept on disk: ${(err as Error).message}`,
      );
    }
  };

  restore();

  /**
   * UNIT_BOUNDARY_DESCRIPTION: what a reader of the catalog sees, pending
   * Connections included, because a listener recycles every idle harness: a
   * first listing that fails changes a pending Connection into the same
   * unavailable one with no models, and must not take the processes down.
   */
  const fingerprint = (): string =>
    JSON.stringify(
      withPending().map((p) => {
        const listing = native.get(p.connectionId);
        return [
          p.connectionId,
          p.status,
          p.entries.map((e) => [e.name, e.metadata.contextWindow]),
          listing ? [listing.status, listing.ids] : null,
        ];
      }),
    );

  const rebuild = async (): Promise<void> => {
    if (!deps.envReady()) return;
    const state = deps.envState();
    const known = new Map(providers.map((p) => [p.connectionId, p]));
    const [next, nextNative] = await Promise.all([
      Promise.all(
        state.providers.map((layer) =>
          listProvider(layer, known.get(layer.id)),
        ),
      ),
      Promise.all(
        state.providers.map(
          async (layer) =>
            [layer.id, await listNative(layer, native.get(layer.id))] as const,
        ),
      ),
    ]);
    const before = fingerprint();
    providers = next;
    native = new Map(
      nextNative.flatMap(([id, listing]) => (listing ? [[id, listing]] : [])),
    );
    markListed();
    if (before !== fingerprint()) for (const listener of listeners) listener();
    scheduleRetry();
    writeCache();
  };

  const scheduleRetry = (): void => {
    const unavailable =
      providers.some((p) => p.status === "unavailable") ||
      [...native.values()].some((l) => l.failed);
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
   * (a grant reaching the machine, which also restarts the owner's
   * gateway pod), so its failures retry from the shortest delay again.
   */
  const refresh = (): Promise<void> => {
    retryDelay = retryMs.initial;
    return run();
  };

  const refreshForEnvChange = (): Promise<void> => {
    retryDelay = retryMs.initial;
    const started = run();
    const gate = started.finally(() => {
      if (spawnGate === gate) spawnGate = null;
    });
    spawnGate = gate;
    return started;
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
    settled: async () => {
      await firstListing;
      while (spawnGate) await spawnGate;
    },
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
          const own = binding?.native?.templates.includes(p.template)
            ? binding.native.models
            : null;
          const base = {
            connectionId: p.connectionId,
            alias: p.alias,
            template: p.template,
            displayName: p.displayName,
          };
          if (own === null)
            return {
              ...base,
              status:
                binding && !servesHarness(p, harness, binding)
                  ? "unsupported"
                  : p.status,
              listedAt: p.listedAt,
              native: false,
              models: forHarness(p.entries, harness, binding).map(modelView),
            };
          const listing: NativeListing =
            own === "listed"
              ? (native.get(p.connectionId) ?? {
                  status: "unavailable",
                  listedAt: null,
                  ids: [],
                  failed: false,
                })
              : {
                  status: "listed",
                  listedAt: p.listedAt,
                  ids: own,
                  failed: false,
                };
          return {
            ...base,
            status: listing.status,
            listedAt: listing.listedAt,
            native: true,
            models: listing.ids.map((id) =>
              nativeModelView(p.alias, id, binding),
            ),
          };
        }),
      };
    },
    refresh,
    refreshForEnvChange,
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

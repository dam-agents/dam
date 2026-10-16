import { TRPCError } from "@trpc/server";
import { emit, EventType } from "../../../events.js";
import {
  harnessCapability,
  harnessConfigCatalog,
  routesByModelName,
  routesSessionPairs,
  isPlatformSubagentSetting,
  platformSubagentSettingsError,
  sessionSettingsError,
  type HarnessCapability,
  type HarnessConfigCatalog,
} from "agent-runtime-api";
import { aliasForProviderType } from "api-server-api";
import type {
  HarnessCatalog,
  HarnessConfigChange,
  HarnessConfigService,
  HarnessConfigSnapshotPatch,
  ProviderPresetType,
  SessionPair,
} from "api-server-api";
import { z } from "zod";
import type { SessionPairRepo } from "../infrastructure/session-pair-repo.js";
import {
  qualifiedPairModel,
  sameModelName,
  resolveSessionPair,
} from "../domain/session-pair.js";
import { harnessFits } from "../../templates/index.js";
import { NoDefaultModelError } from "../domain/no-default-model.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import type { HarnessConfigSnapshotRepo } from "../infrastructure/snapshot-repo.js";
import { harnessConfigEvent } from "../domain/harness-config-event.js";
import { getLogger } from "../../../core/logger.js";

const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createHarnessConfigService(deps: {
  surface: string;
  runtimeMutator: RuntimeMutator;
  snapshotRepo: HarnessConfigSnapshotRepo;
  pairRepo: SessionPairRepo;
  catalog: HarnessCatalog;
  ownerSub: string;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  getCapabilities: (agentId: string) => Promise<unknown>;
  specHarness: (agentId: string) => Promise<string | undefined>;
  isSettled: (agentId: string) => Promise<boolean>;
  now?: () => number;
}): HarnessConfigService {
  const now = deps.now ?? (() => Date.now());

  async function requireOwned(agentId: string): Promise<void> {
    if (!(await deps.isOwnedAgent(agentId))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
    }
  }

  return {
    async status(agentId) {
      await requireOwned(agentId);
      const capabilities = await deps.getCapabilities(agentId);
      return {
        supported: harnessConfigSupported(capabilities),
        catalog: harnessConfigCatalogOf(capabilities),
        sessionModel: sessionModelSupported(capabilities),
        modelRouter: routesByModelName(capabilities),
        defaultHarness: defaultHarnessOf(capabilities),
        harnesses: harnessesOf(capabilities),
      };
    },

    async settled(agentId) {
      await requireOwned(agentId);
      return { settled: await deps.isSettled(agentId) };
    },

    async snapshot(agentId, harness) {
      await requireOwned(agentId);
      const [capabilities, snapshot] = await Promise.all([
        deps.getCapabilities(agentId),
        deps.snapshotRepo.read(agentId, harness),
      ]);
      return { hasRun: capabilities != null, snapshot };
    },

    async apply(agentId, change: HarnessConfigChange) {
      await requireOwned(agentId);
      if (change.harness !== undefined) {
        const carried = harnessesOf(await deps.getCapabilities(agentId));
        if (!carried?.some((h) => h.name === change.harness))
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `this agent's image does not carry the ${change.harness} harness; apply its image update first`,
          });
      }
      const ts = now();
      await deps.runtimeMutator.bump(agentId, [
        harnessConfigEvent(agentId, change, ts, new Date(ts + EVENT_TTL_MS)),
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(agentId);
      emit({
        type: EventType.HarnessConfigChanged,
        agentId,
        ownerSub: deps.ownerSub,
        actorSub: deps.ownerSub,
        surface: deps.surface,
      });
      try {
        await deps.snapshotRepo.merge(
          agentId,
          await declaredBy(agentId, change),
          {
            confirmed: false,
            ...(change.harness !== undefined && { harness: change.harness }),
          },
        );
      } catch (err) {
        getLogger().warn(
          { err, agentId },
          "harness-config: recording the declared snapshot failed",
        );
      }
    },

    async sessionPair(agentId) {
      await requireOwned(agentId);
      return resolveRememberedPair(deps, agentId);
    },

    async defaultFor(agentId, harness) {
      await requireOwned(agentId);
      const pair = await resolveFirePair(
        {
          pairRepo: deps.pairRepo,
          catalog: deps.catalog,
          getCapabilities: deps.getCapabilities,
          specHarness: deps.specHarness,
        },
        agentId,
        harness ? { harness } : {},
        false,
      );
      return pair ?? null;
    },

    async rememberSessionPair(agentId, pair) {
      await requireOwned(agentId);
      const carried = harnessesOf(await deps.getCapabilities(agentId));
      if (
        !carried?.some((h) => h.name === pair.harness) ||
        !deps.catalog.harnesses.some((h) => h.name === pair.harness)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `this agent does not carry the ${pair.harness} harness`,
        });
      const granted = await deps.pairRepo.grantedProviders(agentId);
      const routed = routesByModelName(await deps.getCapabilities(agentId));
      if (routed) pair = await routedPair(agentId, pair, granted);
      const provider = granted.find((p) => p.id === pair.provider);
      if (
        pair.provider !== null &&
        (!provider ||
          !harnessFits(
            deps.catalog,
            pair.harness,
            provider.type,
            provider.templateId,
          ))
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `the ${pair.harness} harness cannot run on that provider`,
        });
      const harness = carried.find((h) => h.name === pair.harness);
      const unsupported = Object.keys(pair.settings ?? {}).find(
        (id) =>
          !(isPlatformSubagentSetting(id)
            ? harness?.platformSubagentSettings
            : harness?.sessionSettings?.includes(id)),
      );
      const invalid = unsupported
        ? `the ${pair.harness} harness cannot keep ${unsupported} as a default`
        : pair.settings &&
          (sessionSettingsError(
            harness?.harnessConfigCatalog,
            pair.settings,
            pair.model,
          ) ??
            platformSubagentSettingsError(
              pair.settings,
              (h) => carried.find((c) => c.name === h)?.harnessConfigCatalog,
            ));
      if (invalid)
        throw new TRPCError({ code: "BAD_REQUEST", message: invalid });
      await deps.pairRepo.write(agentId, pair);
    },
  };

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a bare name is refused, since the runtime
   * would resolve it on whatever provider comes first; a model the harness's
   * last reported list does not carry is refused too, so a default never
   * points at a model the provider stopped serving.
   */
  async function routedPair(
    agentId: string,
    pair: SessionPair,
    granted: readonly { id: string; type: ProviderPresetType }[],
  ): Promise<SessionPair> {
    if (pair.model === null) return pair;
    const model = qualifiedPairModel(pair.model);
    if (model === null)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `name the model with its provider, as <provider>/${pair.model}`,
      });
    const alias = model.slice(0, model.indexOf("/"));
    const provider = granted.find(
      (p) => aliasForProviderType(p.type) === alias,
    );
    if (!provider)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `this agent holds no ${alias} provider`,
      });
    const listed = (await deps.snapshotRepo.read(agentId, pair.harness))
      ?.availableModels;
    const spelled = listed
      ?.map((m) => qualifiedPairModel(m.value))
      .find((m): m is string => m !== null && sameModelName(m, model));
    if (listed && spelled === undefined)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `the ${pair.harness} harness does not list ${model} on this agent`,
      });
    return { ...pair, provider: provider.id, model: spelled ?? model };
  }

  async function declaredBy(
    agentId: string,
    change: HarnessConfigChange,
  ): Promise<HarnessConfigSnapshotPatch> {
    const unset = new Set(change.unset ?? []);
    const patch: HarnessConfigSnapshotPatch = {};
    if (change.model !== undefined) patch.model = change.model;
    if (unset.has("model")) patch.model = null;
    if (change.mode !== undefined) patch.mode = change.mode;
    if (unset.has("mode")) patch.mode = null;

    const optionIds = [
      ...Object.keys(change.configOptions ?? {}),
      ...[...unset].filter((f) => f !== "model" && f !== "mode"),
    ];
    if (optionIds.length === 0) return patch;
    const stored = await deps.snapshotRepo.read(agentId, change.harness);
    const configOptions = { ...(stored?.configOptions ?? {}) };
    for (const [id, value] of Object.entries(change.configOptions ?? {})) {
      configOptions[id] = value;
    }
    for (const id of unset) delete configOptions[id];
    return { ...patch, configOptions };
  }
}

export function harnessConfigSupported(capabilities: unknown): boolean {
  if (capabilities == null) return true;
  return (capabilities as { harnessConfig?: unknown }).harnessConfig === true;
}

export function harnessConfigSupportOf(
  capabilities: unknown,
): { supported: boolean; optionIds: string[] | null } | null {
  if (capabilities == null) return null;
  const catalog = harnessConfigCatalogOf(capabilities);
  return {
    supported: harnessConfigSupported(capabilities),
    optionIds: catalog ? catalog.options.map((o) => o.id) : null,
  };
}

export function sessionModelSupported(capabilities: unknown): boolean {
  if (capabilities == null) return false;
  return (capabilities as { sessionModel?: unknown }).sessionModel === true;
}

export function sessionModelChoices(
  capabilities: unknown,
  discovered: readonly { value: string }[] | null,
): string[] | null {
  if (!sessionModelSupported(capabilities)) return null;
  if (discovered?.length) return discovered.map((m) => m.value);
  const catalog = harnessConfigCatalogOf(capabilities);
  const models = catalog?.options.find((o) => o.category === "model");
  return models?.choices.map((c) => c.value) ?? [];
}

function harnessConfigCatalogOf(
  capabilities: unknown,
): HarnessConfigCatalog | null {
  if (capabilities == null) return null;
  const raw = (capabilities as { harnessConfigCatalog?: unknown })
    .harnessConfigCatalog;
  if (raw == null) return null;
  const parsed = harnessConfigCatalog.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function defaultHarnessOf(capabilities: unknown): string | null {
  const raw = (capabilities as { defaultHarness?: unknown } | null)
    ?.defaultHarness;
  return typeof raw === "string" && raw !== "" ? raw : null;
}

export function harnessesOf(capabilities: unknown): HarnessCapability[] | null {
  const raw = (capabilities as { harnesses?: unknown } | null)?.harnesses;
  const parsed = z.array(harnessCapability).safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface PairResolverDeps {
  pairRepo: SessionPairRepo;
  catalog: HarnessCatalog;
  getCapabilities: (agentId: string) => Promise<unknown>;
  specHarness: (agentId: string) => Promise<string | undefined>;
}

export async function resolveRememberedPair(
  deps: PairResolverDeps,
  agentId: string,
): Promise<SessionPair | null> {
  return (await resolveFirePair(deps, agentId, {}, false)) ?? null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the pair an unattended run asks the agent for —
 * the one it names, or, naming only a model, that model on the agent's own
 * harness, or else the pair a person last picked. Undefined when the agent's
 * runtime holds one harness only and would ignore a pair, or runs a harness
 * the catalog does not offer, such as a custom template's own.
 */
export async function resolveFirePair(
  deps: PairResolverDeps,
  agentId: string,
  preferred: { harness?: string; provider?: string; model?: string },
  requireLeases = true,
): Promise<SessionPair | null | undefined> {
  const [stored, granted, capabilities] = await Promise.all([
    deps.pairRepo.read(agentId),
    deps.pairRepo.grantedProviders(agentId),
    deps.getCapabilities(agentId),
  ]);
  const harnesses = harnessesOf(capabilities);
  if (requireLeases && !(harnesses && routesSessionPairs(harnesses)))
    return undefined;
  const agentHarness =
    defaultHarnessOf(capabilities) ??
    (await deps.specHarness(agentId)) ??
    deps.catalog.default;
  if (!deps.catalog.harnesses.some((h) => h.name === agentHarness))
    return undefined;
  const routed = routesByModelName(capabilities);
  const requestedHarness = preferred.harness ?? stored?.harness ?? agentHarness;
  const savedForHarness = stored?.harness === requestedHarness ? stored : null;
  const remembered: SessionPair | null = routed
    ? {
        harness: requestedHarness,
        provider: preferred.provider ?? savedForHarness?.provider ?? null,
        model: preferred.model ?? savedForHarness?.model ?? null,
        ...(savedForHarness?.settings && {
          settings: savedForHarness.settings,
        }),
      }
    : preferred.harness !== undefined
      ? {
          harness: preferred.harness,
          provider: preferred.provider ?? null,
          model: preferred.model ?? null,
        }
      : preferred.model !== undefined
        ? {
            harness: agentHarness,
            provider: stored?.harness === agentHarness ? stored.provider : null,
            model: preferred.model,
          }
        : stored;
  const pair = resolveSessionPair({
    remembered,
    agentHarness,
    defaultHarness: deps.catalog.default,
    granted,
    fits: (harness, type, templateId) =>
      harnessFits(deps.catalog, harness, type, templateId),
    routed,
  });
  if (requireLeases && routed && pair?.model === null && granted.length > 0)
    throw new NoDefaultModelError(preferred.model);
  return pair;
}

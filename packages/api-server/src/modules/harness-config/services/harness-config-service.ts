import { TRPCError } from "@trpc/server";
import { emit, EventType } from "../../../events.js";
import {
  harnessCapability,
  harnessConfigCatalog,
  type HarnessCapability,
  type HarnessConfigCatalog,
} from "agent-runtime-api";
import type {
  HarnessCatalog,
  HarnessConfigChange,
  HarnessConfigService,
  HarnessConfigSnapshotPatch,
  SessionPair,
} from "api-server-api";
import { z } from "zod";
import type { SessionPairRepo } from "../infrastructure/session-pair-repo.js";
import { resolveSessionPair } from "../domain/session-pair.js";
import { harnessFits } from "../../templates/index.js";
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
      const provider = granted.find((p) => p.id === pair.provider);
      if (
        pair.provider !== null &&
        (!provider || !harnessFits(deps.catalog, pair.harness, provider.type))
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `the ${pair.harness} harness cannot run on that provider`,
        });
      await deps.pairRepo.write(agentId, pair);
    },
  };

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

function sessionModelSupported(capabilities: unknown): boolean {
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

function defaultHarnessOf(capabilities: unknown): string | null {
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
  if (requireLeases && !harnessesOf(capabilities)) return undefined;
  const agentHarness = defaultHarnessOf(capabilities) ?? deps.catalog.default;
  if (
    requireLeases &&
    !deps.catalog.harnesses.some((h) => h.name === agentHarness)
  )
    return undefined;
  const remembered: SessionPair | null =
    preferred.harness !== undefined
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
  return resolveSessionPair({
    remembered,
    agentHarness,
    defaultHarness: deps.catalog.default,
    granted,
    fits: (harness, type) => harnessFits(deps.catalog, harness, type),
  });
}

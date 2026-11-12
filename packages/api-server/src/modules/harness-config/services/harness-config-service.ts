import { TRPCError } from "@trpc/server";
import { emit, EventType } from "../../../events.js";
import {
  harnessCapability,
  harnessConfigCatalog,
  routesByModelName,
  agentToolApprovalSetting,
  routesSessionPairs,
  type HarnessCapability,
  type HarnessConfigCatalog,
} from "agent-runtime-api";
import { aliasForProviderType } from "api-server-api";
import type {
  DefaultKind,
  HarnessCatalog,
  HarnessConfigChange,
  HarnessConfigService,
  HarnessConfigSnapshotPatch,
  OwnerModelCatalogView,
  ProviderPresetType,
  SessionPair,
  SessionChoiceReferences,
} from "api-server-api";
import { z } from "zod";
import type { SessionPairRepo } from "../infrastructure/session-pair-repo.js";
import {
  automaticModel,
  composedSubagent,
  qualifiedPairModel,
  sameModelName,
  resolveSessionPair,
  defaultSettingsProblem,
  splitPlatformSubagent,
  withoutPairApproval,
  withPlatformSubagent,
  type LentSubagent,
} from "../domain/session-pair.js";
import { harnessFits } from "../../templates/index.js";
import { NoDefaultModelError } from "../domain/no-default-model.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import type { HarnessConfigSnapshotRepo } from "../infrastructure/snapshot-repo.js";
import type { DbTx } from "db";
import type { HarnessConfigEventQueue } from "../infrastructure/config-event-queue.js";
import { getLogger } from "../../../core/logger.js";
import type { PublishSessionDefaults } from "./session-defaults-publisher.js";
import type { ProfileResolver } from "../../profiles/index.js";

export function createHarnessConfigService(deps: {
  surface: string;
  eventQueue: HarnessConfigEventQueue;
  runtimeMutator: RuntimeMutator;
  snapshotRepo: HarnessConfigSnapshotRepo;
  pairRepo: SessionPairRepo;
  catalog: HarnessCatalog;
  ownerSub: string;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  getCapabilities: (agentId: string) => Promise<unknown>;
  /* UNIT_BOUNDARY_DESCRIPTION: the owner's catalog for one agent's Connections, the same listing the picker offers, which says whether a model runs on the agent's own provider (D193B). */
  ownerCatalog: (agentId: string) => Promise<OwnerModelCatalogView>;
  specHarness: (agentId: string) => Promise<string | undefined>;
  isSettled: (agentId: string) => Promise<boolean>;
  hiddenHarnesses: () => Promise<ReadonlySet<string>>;
  retireReset?: (
    agentId: string,
    tx: DbTx,
    harness?: string,
  ) => Promise<unknown>;
  publishDefaults: PublishSessionDefaults;
  resolveProfile: ProfileResolver;
}): HarnessConfigService {
  async function requireOwned(agentId: string): Promise<void> {
    if (!(await deps.isOwnedAgent(agentId))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
    }
  }

  return {
    async status(agentId) {
      await requireOwned(agentId);
      const [capabilities, hidden] = await Promise.all([
        deps.getCapabilities(agentId),
        deps.hiddenHarnesses(),
      ]);
      return {
        supported: harnessConfigSupported(capabilities),
        catalog: harnessConfigCatalogOf(capabilities),
        sessionModel: sessionModelSupported(capabilities),
        modelRouter: routesByModelName(capabilities),
        followsDefaults: followsDefaults(capabilities),
        defaultHarness: defaultHarnessOf(capabilities),
        harnesses:
          harnessesOf(capabilities)?.filter((h) => !hidden.has(h.name)) ?? null,
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
      /* UNIT_BOUNDARY_DESCRIPTION: the change the Agent is sent and the
       * declaration the panel shows commit together under the snapshot lock, so
       * a reset or a second change cannot reorder one against the other. */
      await deps.snapshotRepo.locked(agentId, async (tx) => {
        /* UNIT_BOUNDARY_DESCRIPTION: an explicit mode choice outranks a pending
         * one-off correction, and retires it here so a runtime report of the old
         * mode arriving afterwards cannot bring the correction back. A change
         * that carries no mode leaves the correction alone, and the harness the
         * choice names decides whether it is about this correction at all. */
        if (change.mode !== undefined || change.unset?.includes("mode"))
          await deps.retireReset?.(agentId, tx, change.harness);
        await deps.eventQueue.queue(agentId, change, tx);
        await deps.snapshotRepo.merge(
          agentId,
          await declaredBy(agentId, change, tx),
          {
            confirmed: false,
            ...(change.harness !== undefined && { harness: change.harness }),
            tx,
          },
        );
      });
      await deps.runtimeMutator.enqueueAfterCommit(agentId).catch((err) => {
        getLogger().warn(
          { err, agentId },
          "harness-config: asking the agent to fetch the change failed",
        );
      });
      emit({
        type: EventType.HarnessConfigChanged,
        agentId,
        ownerSub: deps.ownerSub,
        actorSub: deps.ownerSub,
        surface: deps.surface,
      });
    },

    async sessionPair(agentId, kind) {
      await requireOwned(agentId);
      return resolveRememberedPair(deps, agentId, kind);
    },

    async sessionDefaults(agentId) {
      await requireOwned(agentId);
      return deps.pairRepo.readSaved(agentId);
    },

    async defaultFor(agentId, kind, harness) {
      await requireOwned(agentId);
      const pair = await resolveFirePair(
        {
          pairRepo: deps.pairRepo,
          catalog: deps.catalog,
          getCapabilities: deps.getCapabilities,
          specHarness: deps.specHarness,
          ownerCatalog: deps.ownerCatalog,
        },
        agentId,
        kind,
        harness ? { harness } : {},
        false,
      );
      return pair ?? null;
    },

    async republishDefaults(agentId) {
      await requireOwned(agentId);
      const pair = await deps.pairRepo.read(agentId, "chat");
      if (pair === null) return "the profile cannot run on this agent";
      try {
        await validDefaultPair(agentId, pair);
      } catch (err) {
        return (err as Error).message;
      }
      await deps.publishDefaults(agentId);
      notifyDefaultChanged(agentId);
      return null;
    },

    async clearSessionDefault(agentId, kind) {
      await requireOwned(agentId);
      await deps.pairRepo.clear(agentId, kind);
      await deps.publishDefaults(agentId);
      notifyDefaultChanged(agentId);
    },

    async setToolApproval(agentId, toolApproval) {
      await requireOwned(agentId);
      const carried = harnessesOf(await deps.getCapabilities(agentId)) ?? [];
      const taken = carried.some(
        (h) =>
          agentToolApprovalSetting(h.harnessConfigCatalog, toolApproval, {
            model: null,
            unattended: false,
          }) !== null,
      );
      if (toolApproval !== null && carried.length > 0 && !taken)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `none of this agent's harnesses takes the ${toolApproval} tool approval from the agent`,
        });
      await deps.pairRepo.writeToolApproval(agentId, toolApproval);
      await deps.publishDefaults(agentId);
      notifyDefaultChanged(agentId);
    },

    async rememberSessionPair(agentId, kind, pair, references) {
      await requireOwned(agentId);
      if ((references?.profileId ?? null) !== null && kind !== "chat")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "only the chat default can name a profile",
        });
      const { intent } = await validChoice(agentId, pair, references);
      await deps.pairRepo.write(agentId, kind, intent, references);
      await deps.publishDefaults(agentId);
      notifyDefaultChanged(agentId);
    },

    async validateChoice(agentId, pair, references) {
      await requireOwned(agentId);
      await validChoice(agentId, pair, references);
    },
  };

  /* UNIT_BOUNDARY_DESCRIPTION: the pair a pick in the chat default's shape runs on, checked as a saved default is: each profile it names the caller's and runnable, and the composed pair one the agent can start on. */
  async function validChoice(
    agentId: string,
    pair: SessionPair | null,
    references: SessionChoiceReferences | undefined,
  ): Promise<{ validated: SessionPair; intent: SessionPair }> {
    const profileId = references?.profileId ?? null;
    {
      const owned = async (id: string) => {
        const resolved = await deps.resolveProfile({
          profileId: id,
          agentId,
          owner: deps.ownerSub,
        });
        if (!resolved)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "profile not found",
          });
        if (resolved.unavailable)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: resolved.unavailable,
          });
        return resolved;
      };
      const [, ownSlot] = pair ? splitPlatformSubagent(pair) : [null, null];
      let primary = pair;
      let lent: LentSubagent | null = null;
      if (profileId !== null) {
        const resolved = await owned(profileId);
        primary = resolved.pair;
        lent = {
          settings: resolved.subagent,
          unavailable: resolved.subagentUnavailable,
        };
      }
      if (!primary)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "pick a profile or a model",
        });
      const slotId = references?.platformSubagentProfileId ?? null;
      if (slotId !== null) await owned(slotId);
      /* UNIT_BOUNDARY_DESCRIPTION: a pick is composed as a run composes it, so the sub-agent the default would spawn is the one checked here (D193B). */
      const subagent = await composedSubagent(
        {
          platformSubagentProfileId: slotId,
          platformSubagentSettings: ownSlot,
        },
        lent,
        deps.resolveProfile,
        agentId,
        deps.ownerSub,
      );
      if (subagent.refused)
        throw new TRPCError({ code: "BAD_REQUEST", message: subagent.refused });
      const validated = await validDefaultPair(
        agentId,
        withPlatformSubagent(primary, subagent.settings ?? null),
      );
      /* UNIT_BOUNDARY_DESCRIPTION: what a save stores is the caller's own pick, never the pair validation composed: a profile's lent sub-agent reaches every run through the reference, and storing it as an own slot would outlive the profile's next edit (D193B). */
      const intent = await composedSubagent(
        {
          platformSubagentProfileId: slotId,
          platformSubagentSettings: ownSlot,
        },
        null,
        deps.resolveProfile,
        agentId,
        deps.ownerSub,
      );
      return {
        validated,
        intent: await validDefaultPair(
          agentId,
          withPlatformSubagent(primary, intent.settings ?? null),
        ),
      };
    }
  }

  async function validDefaultPair(
    agentId: string,
    pair: SessionPair,
  ): Promise<SessionPair> {
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
    if (routed && pair.model === null)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "pick a model for the default; it cannot be left unset",
      });
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
    const invalid = defaultSettingsProblem(
      carried,
      await deps.ownerCatalog(agentId),
      pair,
    );
    if (invalid) throw new TRPCError({ code: "BAD_REQUEST", message: invalid });
    return withoutPairApproval(
      pair,
      carried.find((h) => h.name === pair.harness)?.harnessConfigCatalog,
    );
  }

  function notifyDefaultChanged(agentId: string): void {
    emit({
      type: EventType.HarnessConfigChanged,
      ownerSub: deps.ownerSub,
      agentId,
    });
    emit({
      type: EventType.AttentionChanged,
      ownerSub: deps.ownerSub,
      agentId,
    });
  }

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
    tx: DbTx,
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
    const stored = await deps.snapshotRepo.read(agentId, change.harness, tx);
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: a runtime takes the session-defaults event only
 * from the build that lets its sessions follow a default; an older one has
 * no follow state for the UI to show or change.
 */
export function followsDefaults(capabilities: unknown): boolean {
  const events = (capabilities as { events?: unknown } | null)?.events;
  return Array.isArray(events) && events.includes("session-defaults");
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
  pairRepo: Pick<SessionPairRepo, "read" | "readSaved" | "grantedProviders">;
  catalog: HarnessCatalog;
  getCapabilities: (agentId: string) => Promise<unknown>;
  specHarness: (agentId: string) => Promise<string | undefined>;
  ownerCatalog: (
    agentId: string,
  ) => Promise<Pick<OwnerModelCatalogView, "providers">>;
  /* UNIT_BOUNDARY_DESCRIPTION: present only where the deployment offers its shared CurveBender: an Agent holding no provider at all is then refused as still setting up while that grant is asked for, since the provider is on its way and the next run finds it. */
  onNoProvider?: (agentId: string) => void;
}

export async function resolveRememberedPair(
  deps: PairResolverDeps,
  agentId: string,
  kind: DefaultKind,
): Promise<SessionPair | null> {
  return (await resolveFirePair(deps, agentId, kind, {}, false)) ?? null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the pair an unattended run asks the agent for —
 * the one it names, or, naming only a model, that model on the agent's own
 * harness, or else the default saved for its kind of run (chat, channel or
 * scheduled, the last two falling back to chat). With no model in the
 * resolved pair, the run takes the automatic model of the providers the
 * agent holds, whether it saved a model its provider no longer serves or a
 * chat profile that cannot run, and the saved harness is kept. A pair that
 * still has no model while the agent holds a fitting provider goes to the
 * agent as it is, for the runtime to resolve; only an agent holding no
 * provider at all is refused, as still setting up where the deployment's
 * shared CurveBender is on its way to it. Undefined when
 * the agent's runtime holds one harness only and would ignore a pair, or runs
 * a harness the catalog does not offer, such as a custom template's own.
 */
export async function resolveFirePair(
  deps: PairResolverDeps,
  agentId: string,
  kind: DefaultKind,
  preferred: { harness?: string; provider?: string; model?: string },
  requireLeases = true,
): Promise<SessionPair | null | undefined> {
  const [stored, granted, capabilities] = await Promise.all([
    deps.pairRepo.read(agentId, kind),
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
  /* UNIT_BOUNDARY_DESCRIPTION: a chat profile that cannot run reads as no default, so the pair it names stands in for the run rather than the agent's default harness, its model included: the pair resolver keeps that model only where a provider the agent holds serves it, and drops it for the automatic model otherwise. */
  const profileFallback =
    stored === null
      ? ((await deps.pairRepo.readSaved(agentId)).chatProfilePair ?? null)
      : null;
  const runPair = stored ?? profileFallback;
  const requestedHarness =
    preferred.harness ?? runPair?.harness ?? agentHarness;
  const savedForHarness =
    runPair?.harness === requestedHarness ? runPair : null;
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
            provider:
              runPair?.harness === agentHarness ? runPair.provider : null,
            model: preferred.model,
          }
        : runPair;
  const pair = resolveSessionPair({
    remembered,
    agentHarness,
    defaultHarness: deps.catalog.default,
    granted,
    fits: (harness, type, templateId) =>
      harnessFits(deps.catalog, harness, type, templateId),
    routed,
  });
  if (routed && pair?.model === null) {
    const automatic = automaticModel(
      (await deps.ownerCatalog(agentId)).providers,
      pair,
    );
    if (automatic) return { ...pair, ...automatic };
    /* UNIT_BOUNDARY_DESCRIPTION: a fitting provider that has listed nothing yet still runs the pair once its listing lands, so the runtime resolves the model; an agent holding no provider at all is refused as still setting up where a shared CurveBender is being granted to it, and asked for that grant here, since it may have said hello before the deployment offered its key. */
    if (requireLeases && granted.length === 0) {
      if (!deps.onNoProvider) throw new NoDefaultModelError();
      deps.onNoProvider(agentId);
      throw new NoDefaultModelError({ pending: true });
    }
  }
  return pair;
}

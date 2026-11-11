import {
  type HarnessCapability,
  routesByModelName,
  isPlatformSubagentSetting,
  platformSubagentSettingsError,
  sessionSettingsError,
  type SessionSettings,
} from "agent-runtime-api";
import {
  aliasForProviderType,
  type HarnessCatalog,
  type OwnerModelCatalogView,
} from "api-server-api";
import type { SessionPairRepo } from "../infrastructure/session-pair-repo.js";
import type { HarnessConfigSnapshotRepo } from "../infrastructure/snapshot-repo.js";
import { harnessFits } from "../../templates/index.js";
import { NoDefaultModelError } from "../domain/no-default-model.js";
import {
  legacyModelName,
  qualifiedPairModel,
  runSubagentSettings,
  sameModelName,
} from "../domain/session-pair.js";
import { harnessesOf, sessionModelChoices } from "./harness-config-service.js";

export interface SessionChoices {
  harness?: string;
  model?: string;
  settings?: SessionSettings;
}

export type SessionChoicesValidator = (
  agentId: string,
  choices: SessionChoices,
) => Promise<string | undefined>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one check a schedule's choices pass at save
 * and again at fire, so a fire never runs on a substitute. Returns the
 * reason a choice is refused, undefined when all pass.
 */
export function createSessionChoicesValidator(deps: {
  catalog: HarnessCatalog;
  pairRepo: Pick<SessionPairRepo, "grantedProviders" | "read">;
  snapshotRepo: Pick<HarnessConfigSnapshotRepo, "read">;
  getCapabilities: (agentId: string) => Promise<unknown>;
  ownerCatalog: (
    agentId: string,
  ) => Promise<Pick<OwnerModelCatalogView, "providers">>;
  firePair: (
    agentId: string,
    kind: "scheduled",
    preferred: { harness?: string; model?: string },
  ) => Promise<
    | {
        harness: string;
        provider?: string | null;
        model: string | null;
      }
    | null
    | undefined
  >;
}): SessionChoicesValidator {
  /**
   * UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when agents.runtimeFleet.outdated is empty on prod.
   * A schedule names no harness or settings, and its model must be one of
   * the listed choices.
   */
  const legacyChoices = async (
    agentId: string,
    capabilities: unknown,
    choices: SessionChoices,
  ): Promise<string | undefined> => {
    if (choices.harness !== undefined || choices.settings !== undefined)
      return "this agent's runtime takes no harness or settings for a schedule; update its image first";
    if (choices.model === undefined) return undefined;
    const listed = harnessesOf(capabilities)
      ? []
      : sessionModelChoices(
          capabilities,
          (await deps.snapshotRepo.read(agentId))?.availableModels ?? null,
        );
    if (listed === null)
      return "this agent's harness cannot run a session on a chosen model; leave the model unset";
    if (listed.length > 0 && legacyModelName(choices.model, listed) === null)
      return `unknown model "${choices.model}"; choose one of: ${listed.join(", ")}`;
    return undefined;
  };
  /**
   * UNIT_BOUNDARY_DESCRIPTION: one harness process reaches either the Model
   * Router or a provider it runs natively (Bedrock), so a model-valued
   * setting (the subagent model) must be on the side of the model the fire
   * runs, resolved as the fire resolves it (the schedule's own, else the
   * saved default, else the automatic model; with no model to run on the
   * fire's side is unknown and the check passes, since the fire reports
   * it). As in the
   * runtime, a model is native only on a granted provider the harness runs
   * natively. A runtime that names no native templates splits nothing.
   */
  /* UNIT_BOUNDARY_DESCRIPTION: the pair a schedule's fire runs on, resolved the way the runner resolves it: its own harness and model where it names them, else the scheduled default (D193B). */
  const fireOf = async (
    agentId: string,
    choices: SessionChoices,
  ): Promise<{
    harness: string;
    provider: string | null;
    model: string | null;
  } | null> => {
    try {
      const fire = await deps.firePair(agentId, "scheduled", {
        ...(choices.harness !== undefined && { harness: choices.harness }),
        ...(choices.model !== undefined && { model: choices.model }),
      });
      return fire ? { ...fire, provider: fire.provider ?? null } : null;
    } catch (err) {
      if (err instanceof NoDefaultModelError) return null;
      throw err;
    }
  };

  const crossedSubagentModel = async (
    agentId: string,
    carried: readonly HarnessCapability[],
    choices: SessionChoices,
    fire: {
      harness: string;
      provider: string | null;
      model: string | null;
    } | null,
  ): Promise<string | undefined> => {
    if (!fire) return undefined;
    const capability = carried.find((h) => h.name === fire.harness);
    const nativeTemplates = capability?.nativeTemplates ?? [];
    if (nativeTemplates.length === 0 || !choices.settings) return undefined;
    const modelSettings = new Set(
      capability?.harnessConfigCatalog?.options
        .filter((o) => o.category === "model" && o.choices.length === 0)
        .map((o) => o.id),
    );
    const granted = await deps.pairRepo.grantedProviders(agentId);
    const nativeOf = (name: string | null): boolean | undefined => {
      if (name === null) return false;
      const qualified = qualifiedPairModel(name);
      if (qualified === null) return undefined;
      const alias = qualified.slice(0, qualified.indexOf("/"));
      const provider = granted.find(
        (p) => aliasForProviderType(p.type) === alias,
      );
      return (
        provider !== undefined &&
        nativeTemplates.includes(provider.templateId ?? provider.type)
      );
    };
    const fireModel = fire.model;
    const side = nativeOf(fireModel);
    if (side === undefined) return undefined;
    const invalid = sessionSettingsError(
      capability?.harnessConfigCatalog,
      choices.settings,
      fireModel,
      side,
    );
    if (invalid) return invalid;
    const crossed = Object.entries(choices.settings).find(([id, value]) => {
      if (!modelSettings.has(id) || value === "") return false;
      const own = nativeOf(value);
      return own !== undefined && own !== side;
    });
    return crossed
      ? `the ${crossed[0]} setting ${crossed[1]} cannot run beside ${fireModel ?? "the default model"}: one harness process reaches either the Model Router or a provider it runs natively, not both`
      : undefined;
  };

  return async (agentId, choices) => {
    const capabilities = await deps.getCapabilities(agentId);
    if (!routesByModelName(capabilities))
      return legacyChoices(agentId, capabilities, choices);
    const carried = harnessesOf(capabilities) ?? [];
    const harness =
      choices.harness ??
      (await deps.pairRepo.read(agentId, "scheduled"))?.harness ??
      (capabilities as { defaultHarness?: string } | null)?.defaultHarness ??
      deps.catalog.default;
    if (
      choices.harness !== undefined &&
      (!carried.some((h) => h.name === harness) ||
        !deps.catalog.harnesses.some((h) => h.name === harness))
    )
      return `this agent does not carry the ${harness} harness`;
    const harnessCapability = carried.find((h) => h.name === harness);
    if (choices.model !== undefined) {
      const model = qualifiedPairModel(choices.model);
      if (model === null)
        return `name the model with its provider, as <provider>/${choices.model}`;
      const alias = model.slice(0, model.indexOf("/"));
      const granted = await deps.pairRepo.grantedProviders(agentId);
      const provider = granted.find(
        (p) => aliasForProviderType(p.type) === alias,
      );
      if (!provider) return `this agent holds no ${alias} provider`;
      if (
        !harnessFits(deps.catalog, harness, provider.type, provider.templateId)
      )
        return `the ${harness} harness cannot run on ${alias}`;
      const listed = (await deps.snapshotRepo.read(agentId, harness))
        ?.availableModels;
      if (listed && !listed.some((m) => sameModelName(m.value, model)))
        return `the ${harness} harness does not list ${model} on this agent`;
    }
    if (choices.settings !== undefined) {
      /* UNIT_BOUNDARY_DESCRIPTION: the settings checked are the ones a fire runs, native subagent values derived by the one rule against the pair the fire resolves, so save and fire agree on what the sub-agent is (D193B). */
      const fire = await fireOf(agentId, choices);
      const effectiveHarness = fire?.harness ?? harness;
      const effectiveCapability =
        carried.find((h) => h.name === effectiveHarness) ?? harnessCapability;
      const catalog = await deps.ownerCatalog(agentId);
      const pair = {
        harness: effectiveHarness,
        provider: fire?.provider ?? null,
        model:
          fire?.model ??
          (choices.model ? qualifiedPairModel(choices.model) : null),
      };
      const template = catalog.providers.find(
        (provider) => provider.connectionId === pair.provider,
      )?.template;
      const native =
        effectiveCapability?.nativeTemplates?.includes(template ?? "") ?? false;
      const settings = runSubagentSettings(
        effectiveCapability,
        catalog,
        pair,
        choices.settings,
      );
      const unsupported = Object.keys(settings).find(
        (id) =>
          !(isPlatformSubagentSetting(id)
            ? effectiveCapability?.platformSubagentSettings
            : effectiveCapability?.sessionSettings?.includes(id)),
      );
      if (unsupported)
        return `the ${effectiveHarness} harness cannot set ${unsupported} for a schedule`;
      const slotIssue = platformSubagentSettingsError(
        settings,
        (h) => carried.find((c) => c.name === h)?.harnessConfigCatalog,
      );
      if (slotIssue) return slotIssue;
      const invalid = sessionSettingsError(
        effectiveCapability?.harnessConfigCatalog,
        settings,
        pair.model,
        native,
      );
      if (invalid) return invalid;
      const crossed = await crossedSubagentModel(
        agentId,
        carried,
        { ...choices, settings },
        fire,
      );
      if (crossed) return crossed;
    }
    return undefined;
  };
}

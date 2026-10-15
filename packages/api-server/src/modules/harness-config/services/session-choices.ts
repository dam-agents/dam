import {
  routesByModelName,
  sessionSettingsError,
  type SessionSettings,
} from "agent-runtime-api";
import { aliasForProviderType, type HarnessCatalog } from "api-server-api";
import type { SessionPairRepo } from "../infrastructure/session-pair-repo.js";
import type { HarnessConfigSnapshotRepo } from "../infrastructure/snapshot-repo.js";
import { harnessFits } from "../../templates/index.js";
import {
  legacyModelName,
  qualifiedPairModel,
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
  return async (agentId, choices) => {
    const capabilities = await deps.getCapabilities(agentId);
    if (!routesByModelName(capabilities))
      return legacyChoices(agentId, capabilities, choices);
    const carried = harnessesOf(capabilities) ?? [];
    const harness =
      choices.harness ??
      (await deps.pairRepo.read(agentId))?.harness ??
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
      const unsupported = Object.keys(choices.settings).find(
        (id) => !harnessCapability?.sessionSettings?.includes(id),
      );
      if (unsupported)
        return `the ${harness} harness cannot set ${unsupported} for a schedule`;
      const invalid = sessionSettingsError(
        harnessCapability?.harnessConfigCatalog,
        choices.settings,
        choices.model ? qualifiedPairModel(choices.model) : null,
      );
      if (invalid) return invalid;
    }
    return undefined;
  };
}

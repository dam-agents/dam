import {
  type HarnessCapability,
  PLATFORM_SUBAGENT_PREFIX,
  SUBAGENT_MODEL_SETTING,
} from "agent-runtime-api";
import type { ProfileWithUsage, SessionPair } from "api-server-api";

/** UNIT_BOUNDARY_DESCRIPTION: one subagent profile drives both kinds of subagent, and each kind takes from it only what it can run. */
export interface SubagentChoice {
  platform: { harness: string; model: string };
  native: { model: string; effort?: string };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the values a subagent profile contributes. A
 * platform sub-agent is another agent, so it takes the profile's harness and
 * model. A native sub-agent runs inside the primary harness process, so it
 * takes the profile's model only where that harness can run it: the same
 * harness always can, another harness only when the agent lists that model for
 * the primary harness. Its effort comes along where the harness offers a
 * subagent effort and the profile names one of its choices. Null means the
 * agent picks its own native subagent, which is the fallback the user chose.
 */
export function subagentChoice(
  profile: ProfileWithUsage,
  primary: SessionPair,
  capability: HarnessCapability | undefined,
  agentModels: readonly { name: string }[],
): SubagentChoice {
  const catalogue = capability?.harnessConfigCatalog;
  /* UNIT_BOUNDARY_DESCRIPTION: a harness that does not keep these settings in a
   * session refuses them, so the rule only writes the ones its manifest lists. */
  const keeps = (id: string) =>
    capability?.sessionSettings?.includes(id) === true;
  const runnable =
    keeps(SUBAGENT_MODEL_SETTING) &&
    (profile.harness === primary.harness ||
      agentModels.some((model) => model.name === profile.model));
  const effortOption = catalogue?.options.find(
    (option) => option.id === "subagentEffort",
  );
  const effort = profile.settings.effort;
  return {
    platform: { harness: profile.harness, model: profile.model },
    native: runnable
      ? {
          model: profile.model,
          ...(effort !== undefined &&
            keeps("subagentEffort") &&
            effortOption?.choices.some((choice) => choice.value === effort) && {
              effort,
            }),
        }
      : { model: "" },
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: the settings a subagent profile writes onto a pair: the platform slot's harness and model, and the native subagent's model and effort where it applies. An empty native model clears it, so the agent picks. */
export function subagentSettings(
  choice: SubagentChoice | null,
): Record<string, string> {
  if (choice === null)
    return { "platformSubagent.harness": "", "platformSubagent.model": "" };
  return {
    "platformSubagent.harness": choice.platform.harness,
    "platformSubagent.model": choice.platform.model,
    [SUBAGENT_MODEL_SETTING]: choice.native.model,
    subagentEffort: choice.native.effort ?? "",
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: the pair a subagent pick produces: the slot's keys and the native ones set from the resolution rule, or every one of them cleared when the agent picks. */
export function withSubagent(
  pair: SessionPair,
  profile: ProfileWithUsage | null,
  capability?: HarnessCapability,
  models: readonly { name: string }[] = [],
): SessionPair {
  const settings = { ...(pair.settings ?? {}) };
  for (const key of [
    "platformSubagent.harness",
    "platformSubagent.model",
    "subagentModel",
    "subagentEffort",
  ])
    delete settings[key];
  const choice =
    profile === null ? null : subagentChoice(profile, pair, capability, models);
  for (const [key, value] of Object.entries(subagentSettings(choice)))
    if (value !== "") settings[key] = value;
  return Object.keys(settings).length > 0
    ? { ...pair, settings }
    : { ...pair, settings: undefined };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the settings a primary profile pick saves. The
 * profile's own settings win, the slot the session already names keeps its keys,
 * and that slot is re-applied through the rule for the harness the pick lands
 * on: `models` is that harness's own listing when the pick stays where it was,
 * so a native model the harness keeps and lists survives the pick instead of
 * silently falling back to the agent's pick.
 */
export function primaryPickSettings(input: {
  profile: ProfileWithUsage;
  slot: ProfileWithUsage | null;
  capability: HarnessCapability | undefined;
  models?: readonly { name: string }[];
  kept?: Record<string, string>;
}): Record<string, string> {
  return {
    ...input.kept,
    ...input.profile.settings,
    ...(input.slot === null
      ? {}
      : (withSubagent(
          {
            harness: input.profile.harness,
            provider: null,
            model: input.profile.model,
          },
          input.slot,
          input.capability,
          input.models,
        ).settings ?? {})),
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: the settings a subagent choice writes, which say nothing about the primary: the platform slot's keys and the native subagent's model and effort. */
const isSubagentKey = (id: string): boolean =>
  id.startsWith(PLATFORM_SUBAGENT_PREFIX) ||
  id === SUBAGENT_MODEL_SETTING ||
  id === "subagentEffort";

/**
 * UNIT_BOUNDARY_DESCRIPTION: which profile the primary slot names, found by the
 * harness, the model and the settings the profile holds. Every key a subagent
 * choice writes is left out of the comparison — the slot's and the native
 * subagent's — because both are written onto the same pair and neither may make
 * the primary stop being that profile (QA D2).
 */
export function primaryProfileOf(
  pair: SessionPair | null,
  profiles: readonly ProfileWithUsage[],
): ProfileWithUsage | null {
  if (pair === null) return null;
  const own = (value: Readonly<Record<string, string>> | undefined) =>
    JSON.stringify(
      Object.entries(value ?? {})
        .filter(([id]) => !isSubagentKey(id))
        .sort(),
    );
  return (
    profiles.find(
      (profile) =>
        profile.harness === pair.harness &&
        profile.model === pair.model &&
        own(profile.settings) === own(pair.settings),
    ) ?? null
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: which profile the subagent slot names, found by the harness and model it holds; a slot with no harness is the agent's pick. */
export function subagentProfileOf(
  pair: SessionPair | null,
  profiles: readonly ProfileWithUsage[],
): ProfileWithUsage | null {
  const harness = pair?.settings?.["platformSubagent.harness"];
  const model = pair?.settings?.["platformSubagent.model"];
  if (harness === undefined || model === undefined) return null;
  return (
    profiles.find((p) => p.harness === harness && p.model === model) ?? null
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the references a save writes when the subagent
 * section made the choice — the slot's profile, and the primary's own reference,
 * which a slot write never changes and must never detach (QA D2). Every subagent
 * save path uses this, so no one of them can drop the primary's profile.
 */
export function subagentSaveReferences(input: {
  pair: SessionPair | null;
  slot: ProfileWithUsage | null;
  profiles: readonly ProfileWithUsage[];
}): { platformSubagentProfileId: string | null; profileId: string | null } {
  return {
    platformSubagentProfileId: input.slot?.id ?? null,
    profileId: primaryProfileOf(input.pair, input.profiles)?.id ?? null,
  };
}

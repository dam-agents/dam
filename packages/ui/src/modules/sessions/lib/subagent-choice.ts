import {
  type HarnessCapability,
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
  const runnable =
    profile.harness === primary.harness ||
    agentModels.some((model) => model.name === profile.model);
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

import {
  approvalOption,
  type HarnessCapability,
  isPlatformSubagentSetting,
  SUBAGENT_MODEL_SETTING,
} from "agent-runtime-api";
import type { ProfileWithUsage, SessionPair } from "api-server-api";

export const SUBAGENT_KEYS = [
  "platformSubagent.harness",
  "platformSubagent.model",
  SUBAGENT_MODEL_SETTING,
  "subagentEffort",
] as const;

type SubagentPick = Pick<ProfileWithUsage, "harness" | "model"> & {
  settings?: Readonly<Record<string, string>>;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: one subagent choice drives both kinds of
 * subagent. A platform sub-agent is another agent, so it takes the harness and
 * the model. A native sub-agent runs inside the primary harness, so it takes
 * the model only where that harness keeps `subagentModel` and can run it (the
 * same harness, or a model the agent lists for it), with the choice's effort
 * where the harness offers it; otherwise the agent picks. Null clears both.
 */
export function withSubagent(
  pair: SessionPair,
  choice: SubagentPick | null,
  capability: HarnessCapability | undefined,
  models: readonly { name: string }[],
): SessionPair {
  const { settings: current = {}, ...rest } = pair;
  const settings = Object.fromEntries(
    Object.entries(current).filter(
      ([id]) => !(SUBAGENT_KEYS as readonly string[]).includes(id),
    ),
  );
  const keeps = (id: string) =>
    capability?.sessionSettings?.includes(id) === true;
  const effort = choice?.settings?.effort;
  if (choice) {
    settings["platformSubagent.harness"] = choice.harness;
    settings["platformSubagent.model"] = choice.model;
    if (
      keeps(SUBAGENT_MODEL_SETTING) &&
      (choice.harness === pair.harness ||
        models.some((m) => m.name === choice.model))
    ) {
      settings[SUBAGENT_MODEL_SETTING] = choice.model;
      if (
        effort &&
        keeps("subagentEffort") &&
        capability?.harnessConfigCatalog?.options
          .find((o) => o.id === "subagentEffort")
          ?.choices.some((c) => c.value === effort)
      )
        settings.subagentEffort = effort;
    }
  }
  return Object.keys(settings).length > 0 ? { ...rest, settings } : rest;
}

/** UNIT_BOUNDARY_DESCRIPTION: the subagent choice a pair holds, whether a profile's or custom. */
export function subagentOf(pair: SessionPair | null): SubagentPick | null {
  const harness = pair?.settings?.["platformSubagent.harness"];
  const model = pair?.settings?.["platformSubagent.model"];
  return harness && model ? { harness, model } : null;
}

/** UNIT_BOUNDARY_DESCRIPTION: a primary profile pick takes the profile's settings, keeps the subagent choice and re-applies it for the harness it lands on. */
export function pickProfile(
  pair: SessionPair | null,
  profile: ProfileWithUsage,
  capability: HarnessCapability | undefined,
  models: readonly { name: string }[],
): SessionPair {
  const kept = Object.fromEntries(
    Object.entries(pair?.settings ?? {}).filter(
      ([id]) => !isProfileSetting(id, capability),
    ),
  );
  return withSubagent(
    {
      harness: profile.harness,
      provider: null,
      model: profile.model,
      settings: { ...kept, ...profile.settings },
    },
    subagentOf(pair),
    capability,
    models,
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a setting a profile holds: not the subagent slot's, and not tool approval, which is a session's own pick. */
export function isProfileSetting(
  id: string,
  capability: HarnessCapability | undefined,
): boolean {
  return (
    !isPlatformSubagentSetting(id) &&
    id !== approvalOption(capability?.harnessConfigCatalog)?.id
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: the profile the primary slot holds, by its values; neither a subagent choice nor tool approval makes the primary read as custom (QA D2). */
export function primaryProfileOf(
  pair: SessionPair | null,
  profiles: readonly ProfileWithUsage[],
  capability: HarnessCapability | undefined,
): ProfileWithUsage | null {
  if (pair === null) return null;
  const own = (settings: Readonly<Record<string, string>> | undefined) =>
    JSON.stringify(
      Object.entries(settings ?? {})
        .filter(
          ([id]) =>
            isProfileSetting(id, capability) &&
            !(SUBAGENT_KEYS as readonly string[]).includes(id),
        )
        .sort(),
    );
  return (
    profiles.find(
      (p) =>
        p.harness === pair.harness &&
        p.model === pair.model &&
        own(p.settings) === own(pair.settings),
    ) ?? null
  );
}

export function subagentProfileOf(
  pair: SessionPair | null,
  profiles: readonly ProfileWithUsage[],
): ProfileWithUsage | null {
  const slot = subagentOf(pair);
  return (
    profiles.find(
      (p) => p.harness === slot?.harness && p.model === slot.model,
    ) ?? null
  );
}

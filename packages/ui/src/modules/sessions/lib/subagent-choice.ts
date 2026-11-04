import {
  approvalOption,
  type HarnessCapability,
  isNativeSubagentSetting,
  isPlatformSubagentSetting,
  lentSubagentOfProfile,
  PLATFORM_SUBAGENT_PREFIX,
  platformSubagentChoice,
  SUBAGENT_EFFORT_SETTING,
  SUBAGENT_EFFORT_SLOT,
  SUBAGENT_MODEL_SETTING,
} from "agent-runtime-api";
import type {
  ProfileWithUsage,
  SessionChoiceReferences,
  SessionChoiceSlots,
  SessionPair,
} from "api-server-api";

import {
  type ProviderConnectionRef,
  providerOfModel,
} from "./session-pair-options.js";
import { pairSummary } from "./session-settings.js";

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
 * UNIT_BOUNDARY_DESCRIPTION: one subagent choice as the platform slot, the
 * only shape the UI writes: its harness, its model and any settings of its own.
 * The native sub-agent keys a run takes from it are derived at the run
 * boundary, where the server knows the primary's own model listing, so nothing
 * here guesses them. Null clears the slot and every old native key.
 */
export function withSubagent(
  pair: SessionPair,
  choice: SubagentPick | null,
): SessionPair {
  const { settings: current = {}, ...rest } = pair;
  const settings = Object.fromEntries(
    Object.entries(current).filter(
      ([id]) =>
        !(SUBAGENT_KEYS as readonly string[]).includes(id) &&
        !isPlatformSubagentSetting(id),
    ),
  );
  if (choice) {
    for (const [id, value] of Object.entries(choice.settings ?? {}))
      if (!(SUBAGENT_KEYS as readonly string[]).includes(id))
        settings[`${PLATFORM_SUBAGENT_PREFIX}${id}`] = value;
    settings["platformSubagent.harness"] = choice.harness;
    settings["platformSubagent.model"] = choice.model;
  }
  return Object.keys(settings).length > 0 ? { ...rest, settings } : rest;
}

/** UNIT_BOUNDARY_DESCRIPTION: the subagent choice a pair holds, whether a profile's or custom. */
export function subagentOf(pair: SessionPair | null): SubagentPick | null {
  const harness = pair?.settings?.["platformSubagent.harness"];
  const model = pair?.settings?.["platformSubagent.model"];
  return harness && model ? { harness, model } : null;
}

/** UNIT_BOUNDARY_DESCRIPTION: the subagent slot as the pair the Custom screen edits: its harness (the primary's until one is picked), its model and its own settings; mode is never among them, since tool approval is a session's own pick. */
export function subagentPair(pair: SessionPair | null): SessionPair | null {
  if (pair === null) return null;
  const choice = platformSubagentChoice(pair.settings ?? {});
  return {
    harness: choice?.harness ?? pair.harness,
    provider: null,
    model: choice?.model ?? null,
    settings: { ...choice?.configOptions },
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: a Custom screen pick for the subagent slot, written into the session's pair; a harness picked without a model waits for its model, holding only the harness. */
export function withSubagentPair(
  pair: SessionPair,
  sub: SessionPair,
): SessionPair {
  if (sub.model !== null)
    return withSubagent(pair, {
      harness: sub.harness,
      model: sub.model,
      settings: sub.settings ?? {},
    });
  const cleared = withSubagent(pair, null);
  return {
    ...cleared,
    settings: { ...cleared.settings, "platformSubagent.harness": sub.harness },
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: the subagent slot the saved chat default holds, as the settings a pair carries it in, whether or not it can run now: a profile's by its values, or its own. */
export function heldSubagent(
  saved:
    | {
        platformSubagentProfileId?: string | null;
        platformSubagentSettings?: Readonly<Record<string, string>> | null;
      }
    | undefined,
  profiles: readonly ProfileWithUsage[],
): Record<string, string> | null {
  const profile = profiles.find(
    (p) => p.id === saved?.platformSubagentProfileId,
  );
  if (profile)
    return (
      withSubagent(
        { harness: profile.harness, provider: null, model: null },
        profile,
      ).settings ?? null
    );
  return saved?.platformSubagentSettings
    ? { ...saved.platformSubagentSettings }
    : null;
}

/** UNIT_BOUNDARY_DESCRIPTION: a next-session pair that fell back, its provider gone, holds no model and no subagent slot; it takes the slot the saved default holds, so the picker shows it and a primary pick keeps it (QA N3). A pair that names a model is the person's own pick and is kept as it is. */
export function withHeldSubagent(
  pair: SessionPair | null,
  held: Readonly<Record<string, string>> | null,
  harness: string,
): SessionPair | null {
  if (!held || (pair && (pair.model !== null || subagentOf(pair)))) return pair;
  const base = pair ?? { harness, provider: null, model: null };
  return { ...base, settings: { ...base.settings, ...held } };
}

/** UNIT_BOUNDARY_DESCRIPTION: the subagent slot's custom pick as the one summary, its provider named by the model's alias. */
export function subagentSummary(
  pair: SessionPair | null,
  carried: readonly HarnessCapability[],
  providers: readonly ProviderConnectionRef[],
): string | null {
  const sub = subagentPair(pair);
  if (!sub?.model) return null;
  return pairSummary(sub.model, {
    settings: sub.settings,
    capability: carried.find((h) => h.name === sub.harness),
    provider: providerOfModel(sub.model, providers)?.name,
  });
}

/* UNIT_BOUNDARY_DESCRIPTION: a pair with its platform sub-agent slot replaced by `slot`, the primary's own settings kept, so a profile's lent slot and the pair a pick writes share one shape. */
export function withPlatformSlot(
  pair: SessionPair,
  slot: Record<string, string>,
): SessionPair {
  const { settings: _all, ...rest } = pair;
  const primary = Object.fromEntries(
    Object.entries(pair.settings ?? {}).filter(
      ([id]) => !isPlatformSubagentSetting(id) && !isNativeSubagentSetting(id),
    ),
  );
  return { ...rest, settings: { ...primary, ...slot } };
}

/* UNIT_BOUNDARY_DESCRIPTION: a pair with the platform keys split off and no slot, the primary's own native keys kept, as a profile that names no subagent reads. */
function withoutPlatformSlot(pair: SessionPair): SessionPair {
  const { settings: _all, ...rest } = pair;
  const primary = Object.fromEntries(
    Object.entries(pair.settings ?? {}).filter(
      ([id]) => !isPlatformSubagentSetting(id),
    ),
  );
  return Object.keys(primary).length > 0
    ? { ...rest, settings: primary }
    : rest;
}

/** UNIT_BOUNDARY_DESCRIPTION: a profile as the pair its picker edits: its provider named by the owner's Connection, and the sub-agent it names as the platform slot, effort included; a profile that names none keeps its settings untouched, so native subagent values a pre-D193B profile carries survive an unrelated edit. */
export function profileEditPair(
  profile: ProfileWithUsage,
  provider: string | null,
): SessionPair {
  const pair: SessionPair = {
    harness: profile.harness,
    provider,
    model: profile.model,
    settings: profile.settings,
  };
  const lent = lentSubagentOfProfile(profile);
  return lent ? withPlatformSlot(pair, lent) : pair;
}

/** UNIT_BOUNDARY_DESCRIPTION: the settings a profile stores from a pair's read-back shape: its own settings; with a platform slot, no derived native model, and the slot's effort back as `subagentEffort`, the native key a profile keeps it in, so edit and save round-trip it losslessly. */
export function profileSettings(
  pair: SessionPair,
  capability: HarnessCapability | undefined,
): Record<string, string> {
  const all = pair.settings ?? {};
  const slot = Object.fromEntries(
    Object.entries(all).filter(([id]) => isPlatformSubagentSetting(id)),
  );
  const own = Object.fromEntries(
    Object.entries(all).filter(
      ([id]) =>
        !isPlatformSubagentSetting(id) && isProfileSetting(id, capability),
    ),
  );
  if (Object.keys(slot).length === 0) return own;
  const withoutDerived = Object.fromEntries(
    Object.entries(own).filter(([id]) => !isNativeSubagentSetting(id)),
  );
  const effort = slot[SUBAGENT_EFFORT_SLOT];
  return effort === undefined
    ? withoutDerived
    : { ...withoutDerived, [SUBAGENT_EFFORT_SETTING]: effort };
}

/** UNIT_BOUNDARY_DESCRIPTION: the setting changes that turn one pair's settings into another's, a removed one as the empty value that unsets it. */
export function settingChanges(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((id) => before[id] !== after[id])
      .map((id) => [id, after[id] ?? ""]),
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a primary profile pick takes the profile's settings, keeps the subagent choice and re-applies it for the harness it lands on. */
export function pickProfile(
  pair: SessionPair | null,
  profile: ProfileWithUsage,
  capability: HarnessCapability | undefined,
): SessionPair {
  const kept = Object.fromEntries(
    Object.entries(pair?.settings ?? {}).filter(
      ([id]) => !isProfileSetting(id, capability),
    ),
  );
  const primary: SessionPair = {
    harness: profile.harness,
    provider: null,
    model: profile.model,
    settings: { ...kept, ...profile.settings },
  };
  const lent = lentSubagentOfProfile(profile);
  return lent ? withPlatformSlot(primary, lent) : withoutPlatformSlot(primary);
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

/** UNIT_BOUNDARY_DESCRIPTION: a pick in the chat default's shape onto the slots a schedule or a channel keeps, as the server writes a chat default: a named profile stands in for the values, and an omitted subagent reference keeps that slot as it is. */
export function nextSlots(
  current: SessionChoiceSlots,
  pair: SessionPair,
  references: SessionChoiceReferences,
): SessionChoiceSlots {
  const { settings = {}, ...rest } = pair;
  const part = (own: boolean) =>
    Object.fromEntries(
      Object.entries(settings).filter(
        ([id]) => isPlatformSubagentSetting(id) === own,
      ),
    );
  const primary = part(false);
  const subagent = part(true);
  const slotId = references.platformSubagentProfileId;
  return {
    profileId: references.profileId ?? null,
    pair: references.profileId
      ? null
      : Object.keys(primary).length > 0
        ? { ...rest, settings: primary }
        : rest,
    ...(slotId === undefined
      ? {
          platformSubagentProfileId: current.platformSubagentProfileId,
          platformSubagentSettings: current.platformSubagentSettings,
        }
      : {
          platformSubagentProfileId: slotId,
          platformSubagentSettings:
            slotId || Object.keys(subagent).length === 0 ? null : subagent,
        }),
  };
}

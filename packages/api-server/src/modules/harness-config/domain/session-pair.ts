import {
  effectiveSubagentSettings,
  harnessCapability,
  isPlatformSubagentSetting,
  withoutApproval,
  type HarnessCapability,
  type HarnessConfigCatalog,
} from "agent-runtime-api";
import { z } from "zod";
import {
  aliasForProviderType,
  parseQualifiedModel,
  resolveDefaultProvider,
  type OwnerModelCatalogView,
  type ProviderPresetType,
  type SessionChoiceReferences,
  type SessionChoiceSlots,
  type SessionPair,
} from "api-server-api";
import type { ProfileResolver } from "../../profiles/index.js";

export interface GrantedProvider {
  id: string;
  type: ProviderPresetType;
  templateId?: string;
}

/** UNIT_BOUNDARY_DESCRIPTION: the platform sub-agent slot is stored apart from the primary model (D124): a profile reference, which lends only its harness and model (D93), or values of its own. */
export function platformSubagentOf(slot: SessionPair): Record<string, string> {
  return {
    "platformSubagent.harness": slot.harness,
    ...(slot.model !== null && { "platformSubagent.model": slot.model }),
  };
}

/* UNIT_BOUNDARY_DESCRIPTION: a slot of its own replaces every platform sub-agent value, including one a profile lent the pair, so a profile's sub-agent never half-applies beside the slot's (D193B). */
export function withPlatformSubagent(
  pair: SessionPair,
  slot: Record<string, string> | null,
): SessionPair {
  if (!slot) return pair;
  const [own] = splitSubagent(pair.settings);
  return { ...pair, settings: { ...own, ...slot } };
}

export function splitPlatformSubagent(
  pair: SessionPair,
): [SessionPair, Record<string, string> | null] {
  const { settings = {}, ...rest } = pair;
  const [own, slot] = splitSubagent(settings);
  return [own ? { ...rest, settings: own } : rest, slot];
}

/* UNIT_BOUNDARY_DESCRIPTION: a settings record split into the primary's values and the platform sub-agent's, each null where it holds none of them. */
export function splitSubagent(
  settings: Readonly<Record<string, string>> | undefined,
): [Record<string, string> | null, Record<string, string> | null] {
  const entries = Object.entries(settings ?? {});
  const pick = (own: boolean) =>
    Object.fromEntries(
      entries.filter(([id]) => isPlatformSubagentSetting(id) === own),
    );
  const primary = pick(false);
  const slot = pick(true);
  return [
    Object.keys(primary).length > 0 ? primary : null,
    Object.keys(slot).length > 0 ? slot : null,
  ];
}

/** UNIT_BOUNDARY_DESCRIPTION: a pick in the chat default's shape written onto the stored slots, the same for the chat default, a channel and a schedule: a named profile stands in for the values, and an omitted subagent reference leaves that slot as it is (D124). */
export function choiceSlots(
  pair: SessionPair | null,
  references: SessionChoiceReferences | undefined,
): Pick<SessionChoiceSlots, "profileId" | "pair"> &
  Partial<SessionChoiceSlots> {
  const [primary, own] = pair ? splitPlatformSubagent(pair) : [null, null];
  const slotId = references?.platformSubagentProfileId;
  return {
    profileId: references?.profileId ?? null,
    pair: references?.profileId ? null : primary,
    ...(slotId !== undefined && {
      platformSubagentProfileId: slotId,
      platformSubagentSettings: slotId ? null : own,
    }),
  };
}

/* UNIT_BOUNDARY_DESCRIPTION: the harness a pair runs on, as its agent's runtime last reported it; undefined before the agent reports any, which reads as a harness that keeps no native subagents. */
export function harnessCapabilityOf(
  capabilities: unknown,
  harness: string,
): HarnessCapability | undefined {
  const carried = z
    .array(harnessCapability)
    .safeParse(
      (capabilities as { harnesses?: unknown } | null)?.harnesses,
    ).data;
  return carried?.find((h) => h.name === harness);
}

/** UNIT_BOUNDARY_DESCRIPTION: the platform sub-agent a profile lends a slot that holds none of its own, and why it cannot run on the agent; null is a profile that names none. */
export interface LentSubagent {
  settings: Record<string, string> | null;
  unavailable: string | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform sub-agent a composed pair runs, the
 * one place a chat, a channel and a schedule decide it (D193B). A slot names a
 * profile, holds values of its own, or holds nothing: a named profile lends its
 * harness and model (D93) and one that cannot run leaves the subagent to the
 * agent, values are taken as they are, and nothing follows the profile's lent
 * sub-agent. An own slot never inherits the lent one, even an unresolvable one,
 * but a lent sub-agent that would run and cannot refuses the run, so an edit
 * that breaks it is put back rather than silently dropped. The slot holds
 * platform keys only; `withEffectiveSubagent` is what makes it drive the
 * harness's own subagents.
 */
export async function composedSubagent(
  slots: Pick<
    SessionChoiceSlots,
    "platformSubagentProfileId" | "platformSubagentSettings"
  >,
  lent: LentSubagent | null,
  resolveProfile: ProfileResolver,
  agentId: string,
  owner?: string,
): Promise<
  | { settings: Record<string, string> | null; refused?: undefined }
  | { refused: string; settings?: undefined }
> {
  const named = slots.platformSubagentProfileId;
  if (named) {
    const slot = await resolveProfile({
      profileId: named,
      agentId,
      ...(owner !== undefined && { owner }),
    });
    return {
      settings:
        slot?.unavailable === null ? platformSubagentOf(slot.pair) : null,
    };
  }
  if (slots.platformSubagentSettings)
    return { settings: slots.platformSubagentSettings };
  if (lent?.unavailable) return { refused: lent.unavailable };
  return { settings: lent?.settings ?? null };
}

/* UNIT_BOUNDARY_DESCRIPTION: whether the harness's own subagents can run a model: the primary's own Connection lists it for the primary harness, which is the listing the picker offers. An unknown listing, or none, offers nothing (D193B). */
export function runsNativelyIn(
  catalog: Pick<OwnerModelCatalogView, "providers"> | null | undefined,
  pair: Pick<SessionPair, "harness" | "provider">,
): (model: string) => boolean {
  const provider = catalog?.providers.find(
    (p) => p.connectionId === pair.provider,
  );
  return (model) =>
    provider?.models.some(
      (m) => m.harnesses.includes(pair.harness) && sameModelName(m.name, model),
    ) ?? false;
}

/* UNIT_BOUNDARY_DESCRIPTION: the settings a run's payload carries instead of what it was given, for the boundary that builds that payload: a chat's session/new, a channel's turn, a schedule's fire (D193B). */
export type RunSettingsSource = (
  agentId: string,
  pair: Pick<SessionPair, "harness" | "provider" | "model">,
  settings: Record<string, string> | undefined,
) => Promise<Record<string, string>>;

/* UNIT_BOUNDARY_DESCRIPTION: the settings a run's payload carries, the one place the subagent choice becomes both kinds of subagent (D193B): the primary's own settings, the platform slot, and the native keys derived from it against the model the run actually starts on. */
export function runSubagentSettings(
  capability: HarnessCapability | undefined,
  catalog: Pick<OwnerModelCatalogView, "providers"> | null | undefined,
  pair: Pick<SessionPair, "harness" | "provider" | "model">,
  settings: Record<string, string> | undefined,
): Record<string, string> {
  const [primary, platform] = splitSubagent(settings);
  const template = catalog?.providers.find(
    (provider) => provider.connectionId === pair.provider,
  )?.template;
  return effectiveSubagentSettings(
    capability,
    primary ?? {},
    platform,
    runsNativelyIn(catalog, pair),
    capability?.nativeTemplates?.includes(template ?? "") ?? false,
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: the pair a run on stored slots starts on, the same for a chat, a channel and a schedule: the primary profile resolved, else the values, with the subagent slot composed; a primary profile that cannot run, or a lent sub-agent that would run and cannot, refuses with its reason rather than running on another model. */
export async function resolvedChoice(
  slots: SessionChoiceSlots,
  resolveProfile: ProfileResolver,
  agentId: string,
): Promise<
  | { pair: SessionPair | null; refused?: undefined }
  | { refused: { profile: string; detail: string } }
> {
  let primary = slots.pair;
  let lent: LentSubagent | null = null;
  let profileName = "";
  if (slots.profileId) {
    const resolved = await resolveProfile({
      profileId: slots.profileId,
      agentId,
    });
    if (!resolved)
      return {
        refused: { profile: slots.profileId, detail: "it no longer exists" },
      };
    if (resolved.unavailable)
      return {
        refused: {
          profile: resolved.profile.name,
          detail: resolved.unavailable,
        },
      };
    primary = resolved.pair;
    profileName = resolved.profile.name;
    lent = {
      settings: resolved.subagent,
      unavailable: resolved.subagentUnavailable,
    };
  }
  if (!primary) return { pair: null };
  const subagent = await composedSubagent(slots, lent, resolveProfile, agentId);
  if (subagent.refused)
    return { refused: { profile: profileName, detail: subagent.refused } };
  return { pair: withPlatformSubagent(primary, subagent.settings ?? null) };
}

/** UNIT_BOUNDARY_DESCRIPTION: tool approval is one session's own pick, so a saved default never holds one and a stored one is never read. */
export function withoutPairApproval(
  pair: SessionPair,
  catalog: HarnessConfigCatalog | undefined,
): SessionPair {
  const { settings, ...rest } = pair;
  const kept = withoutApproval(catalog, settings);
  return kept && Object.keys(kept).length > 0
    ? { ...rest, settings: kept }
    : rest;
}

export interface SessionPairInputs {
  remembered: SessionPair | null;
  agentHarness: string;
  defaultHarness: string;
  granted: readonly GrantedProvider[];
  fits: (
    harness: string,
    type: ProviderPresetType,
    templateId?: string,
  ) => boolean;
  routed?: boolean;
  availableModels?: (harness: string) => readonly string[] | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code's own spelling (`claude/…`,
 * lowercased) folds into the canonical name. Null for a bare name, which a
 * routed runtime does not accept as a pair's model.
 */
export function qualifiedPairModel(model: string | null): string | null {
  const parsed = model
    ? parseQualifiedModel(model, { claudePrefix: true })
    : null;
  return parsed ? `${parsed.alias}/${parsed.upstreamId}` : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when agents.runtimeFleet.outdated is empty on prod.
 * A runtime from before qualified names knows a model by the spelling it
 * listed (the upstream id, or `claude/<id>` on Claude Code), so a qualified
 * name is sent to it in that spelling; the listed spelling wins, else the
 * upstream id. A bare name is returned as it is.
 */
export function legacyModelName(
  model: string,
  listed: readonly string[] | null,
): string | null {
  const parsed = parseQualifiedModel(model, { claudePrefix: true });
  if (!parsed) return listed === null || listed.includes(model) ? model : null;
  const candidates = [parsed.upstreamId, `claude/${parsed.upstreamId}`];
  if (listed === null) return parsed.upstreamId;
  return (
    listed.find((name) =>
      candidates.some((c) => c.toLowerCase() === name.toLowerCase()),
    ) ?? null
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code lists the catalog lowercased while
 * the provider spells its ids as it likes, so two spellings of one model
 * match without regard to case.
 */
export function sameModelName(listed: string | null, model: string): boolean {
  const a = qualifiedPairModel(listed);
  return a !== null && a.toLowerCase() === model.toLowerCase();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the run stays on the harness asked for, on the
 * model the person or the schedule chose and that model's provider, never a
 * model or provider the platform picks in their place. A model that names no
 * granted provider, or a saved default with no model, comes back with no
 * model, which a run reports as the agent having no default model. No
 * provider that fits the harness is a failed run, never a jump to another
 * harness; with nothing granted at all the run goes ahead with no provider,
 * for an agent that holds its model key some other way.
 */
function resolveRoutedPair(input: SessionPairInputs): SessionPair | null {
  const remembered = input.remembered;
  const harness = remembered?.harness ?? input.agentHarness;
  const forThisHarness = remembered?.harness === harness ? remembered : null;
  const accepts = (p: GrantedProvider): boolean =>
    input.fits(harness, p.type, p.templateId);
  const settings = forThisHarness?.settings;
  if (!input.granted.some(accepts)) {
    if (input.granted.length > 0) return null;
    return {
      harness,
      provider: null,
      model: qualifiedPairModel(forThisHarness?.model ?? null),
      ...(settings && { settings }),
    };
  }
  const wanted = qualifiedPairModel(forThisHarness?.model ?? null);
  const wantedAlias = wanted?.slice(0, wanted.indexOf("/"));
  const provider = wanted
    ? input.granted.find(
        (p) => aliasForProviderType(p.type) === wantedAlias && accepts(p),
      )
    : input.granted.find(
        (p) => p.id === forThisHarness?.provider && accepts(p),
      );
  return {
    harness,
    provider: provider?.id ?? null,
    model: provider && wanted ? wanted : null,
    ...(settings && { settings }),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness, provider and model a session nobody
 * is picking for (a schedule's fire, a channel turn) runs on. Null when no
 * granted provider fits, which the caller reports as a failed run.
 */
export function resolveSessionPair(
  input: SessionPairInputs,
): SessionPair | null {
  if (input.routed) return resolveRoutedPair(input);
  return resolveLeasedPair(input);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when agents.runtimeFleet.outdated is empty on prod.
 * The remembered pair holds while its provider is granted and its harness
 * accepts it, else the platform default harness on the first fitting
 * provider with that harness's own default model, since a model chosen for
 * another provider would not exist there.
 */
function resolveLeasedPair(input: SessionPairInputs): SessionPair | null {
  const fits = (harness: string, provider: GrantedProvider): boolean =>
    input.fits(harness, provider.type, provider.templateId);
  const firstFitting = (harness: string): GrantedProvider | undefined =>
    resolveDefaultProvider({
      harness,
      saved: null,
      granted: input.granted,
      accepts: (p) => fits(harness, p),
    }) ?? undefined;

  const remembered = input.remembered;
  if (remembered) {
    const provider =
      remembered.provider === null
        ? firstFitting(remembered.harness)
        : input.granted.find((p) => p.id === remembered.provider);
    const legacyModel = (model: string | null): string | null =>
      model === null
        ? null
        : legacyModelName(
            model,
            input.availableModels?.(remembered.harness) ?? null,
          );
    if (provider && fits(remembered.harness, provider))
      return {
        ...remembered,
        provider: provider.id,
        model: legacyModel(remembered.model),
      };
    if (input.granted.length === 0)
      return {
        harness: remembered.harness,
        provider: null,
        model:
          remembered.provider === null ? legacyModel(remembered.model) : null,
        ...(remembered.settings && { settings: remembered.settings }),
      };
  } else {
    const provider = firstFitting(input.agentHarness);
    if (provider || input.granted.length === 0)
      return {
        harness: input.agentHarness,
        provider: provider?.id ?? null,
        model: null,
      };
  }
  const fallback = firstFitting(input.defaultHarness);
  return fallback
    ? { harness: input.defaultHarness, provider: fallback.id, model: null }
    : null;
}

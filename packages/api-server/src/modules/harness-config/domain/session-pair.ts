import {
  aliasForProviderType,
  parseQualifiedModel,
  resolveDefaultProvider,
  type ProviderPresetType,
  type SessionPair,
} from "api-server-api";

export interface GrantedProvider {
  id: string;
  type: ProviderPresetType;
  templateId?: string;
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

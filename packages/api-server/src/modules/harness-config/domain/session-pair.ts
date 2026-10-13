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
 * UNIT_BOUNDARY_DESCRIPTION: the run stays on the harness asked for; its
 * provider is the remembered model's when still granted and accepted, else
 * the agent's default for that harness, and its model falls back to that
 * provider's first listed one. No fitting provider is a failed run, never a
 * jump to another harness; with nothing granted at all the run goes ahead
 * with no provider, for an agent that holds its model key some other way.
 */
function resolveRoutedPair(input: SessionPairInputs): SessionPair | null {
  const remembered = input.remembered;
  const harness = remembered?.harness ?? input.agentHarness;
  const forThisHarness = remembered?.harness === harness ? remembered : null;
  const accepts = (p: GrantedProvider): boolean =>
    input.fits(harness, p.type, p.templateId);
  const wanted = qualifiedPairModel(forThisHarness?.model ?? null);
  const wantedAlias = wanted?.slice(0, wanted.indexOf("/"));
  const provider =
    input.granted.find(
      (p) => aliasForProviderType(p.type) === wantedAlias && accepts(p),
    ) ??
    resolveDefaultProvider({
      harness,
      saved: forThisHarness,
      granted: input.granted,
      accepts,
    });
  const settings = forThisHarness?.settings;
  if (!provider) {
    if (input.granted.length > 0) return null;
    return {
      harness,
      provider: null,
      model: qualifiedPairModel(forThisHarness?.model ?? null),
      ...(settings && { settings }),
    };
  }
  const alias = aliasForProviderType(provider.type);
  const remembering = qualifiedPairModel(forThisHarness?.model ?? null);
  const model =
    remembering && remembering.startsWith(`${alias}/`)
      ? remembering
      : (input
          .availableModels?.(harness)
          ?.map(qualifiedPairModel)
          .find((m) => m?.startsWith(`${alias}/`)) ?? null);
  return {
    harness,
    provider: provider.id,
    model,
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
    if (provider && fits(remembered.harness, provider))
      return { ...remembered, provider: provider.id };
    if (input.granted.length === 0)
      return {
        harness: remembered.harness,
        provider: null,
        model: remembered.provider === null ? remembered.model : null,
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

import type { ProviderPresetType, SessionPair } from "api-server-api";

export interface GrantedProvider {
  id: string;
  type: ProviderPresetType;
}

export interface SessionPairInputs {
  remembered: SessionPair | null;
  agentHarness: string;
  defaultHarness: string;
  granted: readonly GrantedProvider[];
  fits: (harness: string, type: ProviderPresetType) => boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness, provider and model a session nobody
 * is picking for runs on — a schedule's fire, a channel turn. The remembered
 * pair holds while its provider is still granted and its harness can run on
 * it; one that names no provider takes the first granted one its harness can
 * run on. With no provider granted at all, the run goes ahead on the pair's
 * harness with no provider, for an agent that holds its model key some other
 * way; a model chosen for a removed provider is dropped there. Otherwise the
 * platform default harness runs on the first granted provider it can, with
 * that harness's own default model, because a model chosen for another
 * provider would not exist there. Null when no granted provider fits either,
 * which the caller reports as a failed run.
 */
export function resolveSessionPair(
  input: SessionPairInputs,
): SessionPair | null {
  const fits = (harness: string, provider: GrantedProvider): boolean =>
    input.fits(harness, provider.type);
  const firstFitting = (harness: string): GrantedProvider | undefined =>
    input.granted.find((p) => fits(harness, p));

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

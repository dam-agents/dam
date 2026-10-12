import {
  harnessFits,
  type HarnessView,
  type ProviderPresetType,
  providerTypeForTemplateId,
  type SessionPair,
} from "api-server-api";

export interface ProviderConnectionRef {
  id: string;
  name: string;
  type: ProviderPresetType;
  templateId?: string;
}

export interface HarnessOption {
  name: string;
  displayName: string;
}

export function harnessOptions(
  carried: readonly string[],
  catalog: readonly HarnessView[],
): HarnessOption[] {
  return carried.map((name) => ({
    name,
    displayName: catalog.find((h) => h.name === name)?.displayName ?? name,
  }));
}

export function providerOptions(
  harness: string,
  catalog: readonly HarnessView[],
  granted: readonly ProviderConnectionRef[],
  owned: readonly ProviderConnectionRef[],
): { granted: ProviderConnectionRef[]; addable: ProviderConnectionRef[] } {
  const fits = (p: ProviderConnectionRef) =>
    harnessFits({ harnesses: catalog }, harness, p.type, p.templateId);
  const grantedIds = new Set(granted.map((p) => p.id));
  return {
    granted: granted.filter(fits),
    addable: owned.filter((p) => !grantedIds.has(p.id) && fits(p)),
  };
}

export function nextPair(
  chosen: SessionPair | null,
  remembered: SessionPair | null,
  carried: readonly string[],
  fittingFor: (harness: string) => readonly string[],
): SessionPair | null {
  for (const pair of [chosen, remembered]) {
    if (!pair || !carried.includes(pair.harness)) continue;
    const fitting = fittingFor(pair.harness);
    if (pair.provider !== null && fitting.includes(pair.provider)) return pair;
    if (fitting[0] !== undefined)
      return { harness: pair.harness, provider: fitting[0], model: null };
  }
  return null;
}

export function grantedProviderRefs(
  grantedIds: readonly string[],
  connections: readonly { id: string; name: string; templateId: string }[],
): { granted: ProviderConnectionRef[]; owned: ProviderConnectionRef[] } {
  const owned = connections.flatMap((c) => {
    const type = providerTypeForTemplateId(c.templateId);
    return type
      ? [{ id: c.id, name: c.name, type, templateId: c.templateId }]
      : [];
  });
  const held = new Set(grantedIds);
  return { granted: owned.filter((p) => held.has(p.id)), owned };
}

export function pairMeta(pair: SessionPair): Record<string, string> {
  return {
    harness: pair.harness,
    ...(pair.provider !== null && { provider: pair.provider }),
    ...(pair.model !== null && { model: pair.model }),
  };
}

export function fittingProviders(
  catalog: readonly HarnessView[],
  granted: readonly ProviderConnectionRef[],
): (harness: string) => string[] {
  return (harness) =>
    providerOptions(harness, catalog, granted, []).granted.map((p) => p.id);
}

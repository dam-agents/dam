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

export function harnessDisplayName(
  name: string,
  catalog: readonly HarnessView[] | undefined,
): string | undefined {
  return catalog && (catalog.find((h) => h.name === name)?.displayName ?? name);
}

export function pairLabel(
  pair: SessionPair,
  catalog: readonly HarnessView[] | undefined,
  granted: readonly ProviderConnectionRef[],
): string | undefined {
  const harness = harnessDisplayName(pair.harness, catalog);
  return (
    harness &&
    [pair.model, harness, granted.find((p) => p.id === pair.provider)?.name]
      .filter(Boolean)
      .join(" · ")
  );
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
  defaultHarness?: string | null,
): SessionPair | null {
  for (const pair of [chosen, remembered]) {
    if (!pair || !carried.includes(pair.harness)) continue;
    const fitting = fittingFor(pair.harness);
    if (pair.provider !== null && fitting.includes(pair.provider)) return pair;
    if (fitting[0] !== undefined)
      return { harness: pair.harness, provider: fitting[0], model: null };
  }
  for (const harness of [defaultHarness, ...carried]) {
    const provider =
      harness && carried.includes(harness) && fittingFor(harness)[0];
    if (provider) return { harness, provider, model: null };
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

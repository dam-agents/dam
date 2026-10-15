import {
  aliasForProviderType,
  aliasOrder,
  type ProviderPresetType,
} from "../connections/providers.js";

export interface ProviderChoice {
  id: string;
  type: ProviderPresetType;
}

export interface SavedProviderChoice {
  harness: string;
  provider: string | null;
}

export function orderByAlias<T extends { type: ProviderPresetType }>(
  granted: readonly T[],
  harness?: string,
): T[] {
  return granted
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        aliasOrder(aliasForProviderType(a.item.type), harness) -
          aliasOrder(aliasForProviderType(b.item.type), harness) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one answer to which provider is an Agent's
 * default for a harness, shared by every caller so they never disagree. The
 * saved pair wins only when it was saved for this very harness and is still
 * granted and accepted; otherwise the first granted provider the harness
 * accepts in alias order.
 */
export function resolveDefaultProvider<T extends ProviderChoice>(input: {
  harness: string;
  saved: SavedProviderChoice | null;
  granted: readonly T[];
  accepts: (provider: T) => boolean;
}): T | null {
  const { harness, saved, granted, accepts } = input;
  if (saved && saved.harness === harness && saved.provider !== null) {
    const chosen = granted.find((p) => p.id === saved.provider);
    if (chosen && accepts(chosen)) return chosen;
  }
  return orderByAlias(granted, harness).find(accepts) ?? null;
}

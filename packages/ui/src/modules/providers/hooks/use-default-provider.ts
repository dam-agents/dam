import type { ProviderPresetType } from "api-server-api";

import { useProviderItems } from "./use-provider-items.js";

/**
 * Auto-pick the first available provider matching the given allow/recommended policy.
 * Returns the connection ID if one is found, or null if no matching provider exists.
 */
export function useDefaultProvider(opts?: {
  allow?: readonly ProviderPresetType[];
  recommended?: ProviderPresetType;
}): { connectionId: string | null; isPending: boolean } {
  const { itemByType, isPending } = useProviderItems();

  if (isPending) return { connectionId: null, isPending: true };

  if (opts?.recommended) {
    const rec = itemByType.get(opts.recommended);
    if (rec) return { connectionId: rec.id, isPending: false };
  }

  if (opts?.allow) {
    for (const type of opts.allow) {
      const item = itemByType.get(type);
      if (item) return { connectionId: item.id, isPending: false };
    }
    return { connectionId: null, isPending: false };
  }

  const first = itemByType.values().next();
  return {
    connectionId: first.done ? null : first.value.id,
    isPending: false,
  };
}

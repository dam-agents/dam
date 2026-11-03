import { providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import type { ProviderPresetType } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import type { ProviderItem } from "../components/provider-item.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: every provider connection the owner holds, by
 * preset and by template, in the order the connections list gives them; an
 * owner can hold several of one provider, and each is its own item.
 */
export function useProviderItems() {
  const { data: connections = [], isPending, isSuccess } = useAppConnections();

  const { itemsByType, itemsByTemplateId, typeByConnectionId } = useMemo(() => {
    const itemsByType = new Map<ProviderPresetType, ProviderItem[]>();
    const itemsByTemplateId = new Map<string, ProviderItem[]>();
    const typeByConnectionId = new Map<string, ProviderPresetType>();
    for (const conn of connections) {
      const preset = providerTypeForTemplateId(conn.templateId);
      if (!preset) continue;
      typeByConnectionId.set(conn.id, preset);
      const item = { id: conn.id, conn };
      itemsByTemplateId.set(conn.templateId, [
        ...(itemsByTemplateId.get(conn.templateId) ?? []),
        item,
      ]);
      itemsByType.set(preset, [...(itemsByType.get(preset) ?? []), item]);
    }
    return { itemsByType, itemsByTemplateId, typeByConnectionId };
  }, [connections]);

  return {
    itemsByType,
    itemsByTemplateId,
    typeByConnectionId,
    isPending,
    isSuccess,
  };
}

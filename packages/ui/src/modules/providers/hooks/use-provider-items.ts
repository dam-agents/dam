import { providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import type { ProviderPresetType } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import type { ProviderItem } from "../components/provider-item.js";

export function useProviderItems() {
  const { data: connections = [], isPending, isSuccess } = useAppConnections();

  const { itemByType, itemByTemplateId, typeByConnectionId } = useMemo(() => {
    const itemByType = new Map<ProviderPresetType, ProviderItem>();
    const itemByTemplateId = new Map<string, ProviderItem>();
    const typeByConnectionId = new Map<string, ProviderPresetType>();
    for (const conn of connections) {
      const preset = providerTypeForTemplateId(conn.templateId);
      if (!preset) continue;
      typeByConnectionId.set(conn.id, preset);
      if (!itemByTemplateId.has(conn.templateId))
        itemByTemplateId.set(conn.templateId, { id: conn.id, conn });
      if (!itemByType.has(preset))
        itemByType.set(preset, { id: conn.id, conn });
    }
    return { itemByType, itemByTemplateId, typeByConnectionId };
  }, [connections]);

  return {
    itemByType,
    itemByTemplateId,
    typeByConnectionId,
    isPending,
    isSuccess,
  };
}

import { providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import type { ProviderPresetType } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import type { ProviderItem } from "../components/provider-item.js";

export function useProviderItems() {
  const { data: connections = [], isPending } = useAppConnections();

  // itemByType keeps one connection per preset, but a sandbox may hold a
  // different connection of the same preset — hence the lookup by id too.
  const { itemByType, typeByConnectionId } = useMemo(() => {
    const itemByType = new Map<ProviderPresetType, ProviderItem>();
    const typeByConnectionId = new Map<string, ProviderPresetType>();
    for (const conn of connections) {
      const preset = providerTypeForTemplateId(conn.templateId);
      if (!preset) continue;
      typeByConnectionId.set(conn.id, preset);
      if (!itemByType.has(preset))
        itemByType.set(preset, { id: conn.id, conn });
    }
    return { itemByType, typeByConnectionId };
  }, [connections]);

  return { itemByType, typeByConnectionId, isPending };
}

import {
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  providerTypeForTemplateId,
} from "api-server-api";
import { useMemo } from "react";

import type { ProviderPresetType } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import type { ProviderItem } from "../components/provider-item.js";

export function useProviderItems() {
  const { data: connections = [], isPending, isSuccess } = useAppConnections();

  const { itemByType, typeByConnectionId, shared } = useMemo(() => {
    const itemByType = new Map<ProviderPresetType, ProviderItem>();
    const typeByConnectionId = new Map<string, ProviderPresetType>();
    let shared: ProviderItem | undefined;
    for (const conn of connections) {
      const preset = providerTypeForTemplateId(conn.templateId);
      if (!preset) continue;
      typeByConnectionId.set(conn.id, preset);
      if (conn.templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID)
        shared ??= { id: conn.id, conn };
      else if (!itemByType.has(preset))
        itemByType.set(preset, { id: conn.id, conn });
    }
    return { itemByType, typeByConnectionId, shared };
  }, [connections]);

  return {
    itemByType,
    typeByConnectionId,
    shared,
    isPending,
    isSuccess,
  };
}

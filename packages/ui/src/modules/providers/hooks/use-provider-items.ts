import { type ConnectionView, providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import type { ProviderPresetType } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import type { ProviderItem } from "../components/provider-item.js";
import { PROVIDER_ROWS } from "../lib/provider-rows.js";

/** The user's provider credentials, keyed by preset type — one connection per
 *  provider (the first one wins if several exist). */
export function useProviderItems() {
  const { data: connections = [], isPending } = useAppConnections();

  const itemByType = useMemo(() => {
    const connByType = new Map<ProviderPresetType, ConnectionView>();
    for (const c of connections) {
      const preset = providerTypeForTemplateId(c.templateId);
      if (preset && !connByType.has(preset)) connByType.set(preset, c);
    }
    const m = new Map<ProviderPresetType, ProviderItem>();
    for (const row of PROVIDER_ROWS) {
      const conn = connByType.get(row.type);
      if (conn) m.set(row.type, { id: conn.id, conn });
    }
    return m;
  }, [connections]);

  return { itemByType, isPending };
}

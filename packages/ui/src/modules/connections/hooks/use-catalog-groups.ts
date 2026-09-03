import {
  type ConnectionTemplateView,
  type ConnectionView,
  PROVIDER_TEMPLATE_IDS,
  SHARED_KB_TEMPLATE_ID,
} from "api-server-api";
import { useMemo } from "react";

import { useFeatures } from "../../features/api/queries.js";
import { useConnectionTemplates } from "../api/queries.js";
import { filterOfferedTemplates } from "../internal-only.js";
import {
  type CatalogProviderGroup,
  type CatalogTab,
  groupCatalog,
} from "../lib/catalog-providers.js";

const NO_TEMPLATES: ConnectionTemplateView[] = [];

export function useCatalogGroups(connections: readonly ConnectionView[]): {
  byTab: Map<CatalogTab, CatalogProviderGroup[]>;
  populated: CatalogProviderGroup[];
  templateById: Map<string, ConnectionTemplateView>;
} {
  const templatesQ = useConnectionTemplates();
  const allTemplates = templatesQ.data ?? NO_TEMPLATES;
  const showInternal = useFeatures().data?.["advanced-connections"] ?? false;

  const byTab = useMemo(
    () =>
      groupCatalog({
        offeredTemplates: filterOfferedTemplates(allTemplates, showInternal)
          .filter((t) => !PROVIDER_TEMPLATE_IDS.has(t.id))
          .filter((t) => t.id !== SHARED_KB_TEMPLATE_ID),
        allTemplates,
        connections: connections.filter(
          (c) =>
            !PROVIDER_TEMPLATE_IDS.has(c.templateId) &&
            c.templateId !== SHARED_KB_TEMPLATE_ID,
        ),
      }),
    [allTemplates, connections, showInternal],
  );
  const populated = useMemo(
    () => [...byTab.values()].flat().filter((g) => g.connections.length > 0),
    [byTab],
  );
  const templateById = useMemo(
    () => new Map(allTemplates.map((t) => [t.id, t])),
    [allTemplates],
  );
  return { byTab, populated, templateById };
}

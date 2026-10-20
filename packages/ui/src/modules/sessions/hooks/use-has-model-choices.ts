import { useHarnessCatalogModels } from "../api/session-pair.js";
import { modelGroups } from "../lib/catalog-groups.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether the agent's runtime lists any model for
 * the harness, so holding a prompt until one is picked never leaves the
 * person with nothing to pick; the runtime still refuses a turn it cannot
 * run.
 */
export function useHasModelChoices(
  agentId: string | null,
  harness: string | null | undefined,
): boolean {
  const catalog = useHarnessCatalogModels(agentId, harness ?? null);
  return modelGroups(catalog.data, catalog.granted).some(
    (g) => g.models.length > 0,
  );
}

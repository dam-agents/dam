import type { HarnessCatalogView } from "agent-runtime-api";
import type { OwnerModelCatalogView } from "./types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: one harness's model list out of the owner-level
 * catalog, in the shape the pickers read. A provider the harness does not fit
 * is `unsupported` with no models, and a model below a harness's limits is
 * left out, both as the shared fit rule decided on the server.
 */
export function harnessCatalogOf(
  catalog: OwnerModelCatalogView,
  harness: string,
): HarnessCatalogView {
  const native = catalog.harnesses.find(
    (h) => h.name === harness,
  )?.nativeTemplates;
  return {
    harness,
    routed: catalog.modelRouter,
    providers: catalog.providers.map(({ harnesses, models, ...provider }) => ({
      ...provider,
      status: harnesses.includes(harness) ? provider.status : "unsupported",
      native: native?.includes(provider.template) ?? false,
      models: models
        .filter((model) => model.harnesses.includes(harness))
        .map(({ harnesses: _, ...model }) => model),
    })),
  };
}

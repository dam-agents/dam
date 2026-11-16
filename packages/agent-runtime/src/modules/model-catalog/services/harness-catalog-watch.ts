import type { ModelCatalog } from "./model-catalog.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the runtime's watch on the Model Catalog, which
 * recycles the Harness Leases when what a harness reads at spawn changed and
 * leaves them alone otherwise. A harness reads its model names and their
 * context windows, so those are compared; a provider's own status is a
 * reader's concern and never recycles, since a gateway that is still coming up
 * on a wake, or a listing that failed over a kept one, turns a Connection
 * unavailable with the very models the harness started on, and a recycle there
 * would take back the process the kept catalog bought.
 */
export function watchHarnessCatalog(deps: {
  catalog: ModelCatalog;
  harnesses: readonly string[];
  changed: () => void;
}): () => void {
  const fingerprint = (): string =>
    JSON.stringify(
      deps.harnesses.map((harness) => [
        harness,
        deps.catalog
          .view(harness)
          .providers.map((provider) => [
            provider.connectionId,
            provider.models.map((model) => [model.name, model.contextWindow]),
          ]),
      ]),
    );
  let seen = fingerprint();
  return deps.catalog.onChange(() => {
    const current = fingerprint();
    if (current === seen) return;
    seen = current;
    deps.changed();
  });
}

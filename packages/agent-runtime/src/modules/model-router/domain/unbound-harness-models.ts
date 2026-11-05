import {
  MIN_CONTEXT_WINDOW,
  preferredModelOf,
  renderName,
} from "api-server-api";
import type {
  CatalogEntry,
  CatalogProvider,
} from "../../model-catalog/index.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model list a harness with no `modelRouter`
 * section gets, such as a kit image's own harness. The router resolves a
 * qualified name for any harness, so such a harness may run on every model
 * the agent's providers list, and this is how it learns their names: each
 * under its plain qualified name, with its dialects in the entry, and the
 * platform's preferred work model first, so a harness that takes the first
 * one runs on the model the platform would pick. A model known to hold less
 * than a harness needs is left out, as for a routed harness, and so is one
 * kept to named harnesses, such as an Anthropic subscription's, which the
 * router would refuse for this one.
 */
export function unboundHarnessModels(
  providers: readonly CatalogProvider[],
): CatalogEntry[] {
  const entries = providers
    .flatMap((p) => p.entries)
    .filter(
      (e) =>
        !e.harnesses &&
        (e.metadata.contextWindow === null ||
          e.metadata.contextWindow >= MIN_CONTEXT_WINDOW),
    )
    .map((e) => ({ ...e, name: renderName(e, undefined) }));
  const preferred = preferredModelOf(
    "work",
    providers.map((p) => ({
      alias: p.alias,
      listed: entries
        .filter((e) => e.alias === p.alias)
        .map((e) => e.upstreamId),
    })),
  );
  const lead = preferred
    ? entries.find(
        (e) =>
          e.alias === preferred.alias && e.upstreamId === preferred.upstreamId,
      )
    : undefined;
  return lead ? [lead, ...entries.filter((e) => e !== lead)] : entries;
}

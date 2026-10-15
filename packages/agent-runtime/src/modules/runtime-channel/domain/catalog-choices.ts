import type {
  HarnessCatalogView,
  HarnessConfigChoice,
} from "agent-runtime-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: each choice is described by its provider and
 * context window so a picker can tell two providers' copies of one model
 * apart. Null when the harness is not routed; empty when nothing is listed
 * yet, which the caller reports as unavailable.
 */
export function catalogChoices(
  view: HarnessCatalogView,
): HarnessConfigChoice[] | null {
  if (!view.routed) return null;
  return view.providers.flatMap((p) =>
    p.models.map((m) => ({
      value: m.name,
      name: m.upstreamId,
      description: [
        p.displayName,
        m.contextWindow !== null
          ? `${Math.round(m.contextWindow / 1000)}k context`
          : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
    })),
  );
}

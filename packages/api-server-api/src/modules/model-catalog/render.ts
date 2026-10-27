import { formatQualifiedModel } from "../harness-config/model-name.js";
import type { CatalogEntry, ModelDialect } from "./catalog-entry.js";

export interface HarnessBinding {
  dialects: readonly ModelDialect[];
  namePrefix?: string;
  lowercaseNames?: boolean;
}

export interface HarnessOffer {
  dialects: readonly ModelDialect[];
  harnesses?: readonly string[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an offer serves a harness when it serves a
 * dialect the harness speaks and, when its template restricts harnesses, the
 * harness is one of them.
 */
export function servesHarness(
  offer: HarnessOffer,
  harness: string,
  binding: HarnessBinding,
): boolean {
  return (
    binding.dialects.some((d) => offer.dialects.includes(d)) &&
    (offer.harnesses?.includes(harness) ?? true)
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a manifest may prefix and lowercase the name,
 * which Claude Code needs because its gateway discovery keeps only ids
 * containing `claude`; the router resolves such a name back to the entry
 * case-insensitively.
 */
export function renderName(
  entry: Pick<CatalogEntry, "alias" | "upstreamId">,
  harness: HarnessBinding | undefined,
): string {
  const name = formatQualifiedModel(entry.alias, entry.upstreamId);
  if (!harness) return name;
  const prefixed = harness.namePrefix ? harness.namePrefix + name : name;
  return harness.lowercaseNames ? prefixed.toLowerCase() : prefixed;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a harness's own instructions and tools take
 * several thousand tokens, so a model known to hold less than this would
 * compact on every turn and is not offered; an unknown window is offered.
 */
export const MIN_CONTEXT_WINDOW = 32_000;

export function forHarness(
  entries: readonly CatalogEntry[],
  harness: string,
  binding: HarnessBinding | undefined,
): CatalogEntry[] {
  if (!binding) return [];
  return entries
    .filter((e) => servesHarness(e, harness, binding))
    .filter(
      (e) =>
        e.metadata.contextWindow === null ||
        e.metadata.contextWindow >= MIN_CONTEXT_WINDOW,
    )
    .map((e) => ({ ...e, name: renderName(e, binding) }));
}

import {
  parseQualifiedModel,
  preferredModelOf,
  type CatalogEntry,
  type CatalogProvider,
} from "api-server-api";

export interface ModelSource {
  providers(): readonly CatalogProvider[];
  forHarness(harness: string): CatalogEntry[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a model a Session names stays usable while its
 * provider alias is granted and the catalog has no verdict against it: a
 * provider that has not listed yet, or whose last listing failed, may still
 * serve it, so only a listed provider that does not name the model rules it
 * out. A deleted model is one such entry, which the Model Router would 404.
 * The upstream id is compared case-insensitively inside the entries the
 * harness is offered, as the Model Router resolves a name: a provider spelling
 * a model its own way (`DeepSeek-V4-Flash`) still serves the Session that
 * names it lowercased.
 */
export function modelUsableOn(
  catalog: ModelSource,
  harness: string,
  model: string,
  granted: readonly string[],
): boolean {
  const parsed = parseQualifiedModel(model, { claudePrefix: true });
  if (!parsed || !granted.includes(parsed.alias)) return false;
  const provider = catalog.providers().find((p) => p.alias === parsed.alias);
  if (provider === undefined || provider.status !== "listed") return true;
  const wanted = parsed.upstreamId.toLowerCase();
  return catalog
    .forHarness(harness)
    .some(
      (e) => e.alias === parsed.alias && e.upstreamId.toLowerCase() === wanted,
    );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model a Session runs on when neither its own
 * nor its kind's default can serve it. The providers the default and then the
 * Session name are a preference, not a wall: the platform's preferred work
 * model among the first of them that lists one wins, else its first listed,
 * else the same across every granted provider. Only entries of currently
 * granted aliases, so a
 * revoked provider's models never come back this way.
 */
export function automaticModelOf(
  catalog: ModelSource,
  harness: string,
  preferAliases: readonly string[],
  granted: readonly string[],
): string | null {
  const entries = catalog
    .forHarness(harness)
    .filter((e) => granted.includes(e.alias));
  const pick = (aliases: readonly string[]): string | null => {
    const listed = aliases.flatMap((alias) => {
      const ids = entries
        .filter((e) => e.alias === alias)
        .map((e) => e.upstreamId);
      return ids.length > 0 ? [{ alias, listed: ids }] : [];
    });
    if (listed.length === 0) return null;
    const preferred = preferredModelOf("work", listed, harness);
    return preferred
      ? `${preferred.alias}/${preferred.upstreamId}`
      : `${listed[0]!.alias}/${listed[0]!.listed[0]!}`;
  };
  for (const alias of preferAliases) {
    const model = pick([alias]);
    if (model) return model;
  }
  return pick([...new Set(entries.map((e) => e.alias))]);
}

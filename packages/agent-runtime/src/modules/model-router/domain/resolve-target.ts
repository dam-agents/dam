import {
  aliasOrder,
  CLAUDE_MODEL_NAME_PREFIX,
  parseQualifiedModel,
  type ProviderAlias,
} from "api-server-api";
import type {
  CatalogEntry,
  CatalogProvider,
  ModelDialect,
} from "../../model-catalog/index.js";
import { renderName, servesHarness } from "../../model-catalog/index.js";
import type { ModelRouterBinding } from "../../runtime-channel/manifest.js";

export interface ResolveInput {
  model: string;
  dialect: ModelDialect;
  harness: ModelRouterBinding | undefined;
  harnessName?: string;
  providers: readonly CatalogProvider[];
  sessionModel: string | null;
}

export type ResolveOutcome =
  | { ok: true; entry: CatalogEntry; publicName: string }
  | { ok: false; status: 400 | 404; reason: string };

const serves = (
  p: CatalogProvider,
  harnessName: string | undefined,
  harness: ModelRouterBinding | undefined,
) => harness !== undefined && servesHarness(p, harnessName ?? "", harness);

const listsBare = (p: CatalogProvider, bare: string): CatalogEntry[] => {
  const hit =
    p.entries.find((e) => e.upstreamId === bare) ??
    p.entries.find((e) => e.upstreamId.toLowerCase() === bare.toLowerCase());
  return hit ? [hit] : [];
};

const listsDeployment = (p: CatalogProvider, bare: string): CatalogEntry[] => {
  const wanted = bare.toLowerCase();
  return p.entries.filter(
    (e) =>
      (e.upstreamId.split("/").at(-1) ?? e.upstreamId).toLowerCase() === wanted,
  );
};

function resolveQualified(
  parsed: { alias: ProviderAlias; upstreamId: string },
  providers: readonly CatalogProvider[],
): CatalogEntry | null {
  const provider = providers.find((p) => p.alias === parsed.alias);
  if (!provider) return null;
  return listsBare(provider, parsed.upstreamId)[0] ?? null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a qualified name is matched case-insensitively
 * on the upstream id because Claude Code lowercases what it discovers. A bare
 * name is looked for on the session's provider, then the harness's default
 * provider, then the single provider that lists it; several candidates are
 * refused by name, so no call is billed to a provider the user did not pick.
 * A bare name no provider lists falls back to the id whose last path segment
 * is that name, compared without case, since a provider fronting a cloud
 * account serves an exact model under the deployment prefix it hosts it on
 * (`aws/<id>`) and a harness names a tier by a bare id of its own; two such
 * ids on one provider are refused by name, so no deployment is guessed
 * between. An id one provider already answers to, in either case, stays a
 * single answer: the first pass keeps the first match, so a catalog with two
 * spellings of one id responds as it did before the fallback existed.
 * The entry must serve the request's dialect: the router never translates.
 */
export function resolveTarget(input: ResolveInput): ResolveOutcome {
  const { model, dialect, harness, providers, sessionModel } = input;
  const claudePrefix = harness?.namePrefix === CLAUDE_MODEL_NAME_PREFIX;
  const parsed = parseQualifiedModel(model, { claudePrefix });
  const known = providers.map((p) => p.alias).join(", ") || "none";
  let entry: CatalogEntry | null = null;
  if (parsed) {
    entry = resolveQualified(parsed, providers);
    if (!entry)
      return {
        ok: false,
        status: 404,
        reason: `unknown model '${model}' (granted providers: ${known})`,
      };
  } else {
    const bare =
      claudePrefix && model.startsWith(CLAUDE_MODEL_NAME_PREFIX)
        ? model.slice(CLAUDE_MODEL_NAME_PREFIX.length)
        : model;
    const eligible = providers.filter((p) =>
      serves(p, input.harnessName, harness),
    );
    const session = parseQualifiedModel(sessionModel, { claudePrefix });
    const onSession = session
      ? eligible.find((p) => p.alias === session.alias)
      : undefined;
    const byDefault = [...eligible].sort(
      (a, b) =>
        aliasOrder(a.alias, input.harnessName) -
        aliasOrder(b.alias, input.harnessName),
    )[0];
    const candidates = (
      lists: (p: CatalogProvider, id: string) => CatalogEntry[],
    ) =>
      eligible.flatMap((p) => {
        const entries = lists(p, bare);
        return entries.length > 0 ? [{ provider: p, entries }] : [];
      });
    const exact = candidates(listsBare);
    const matches = exact.length > 0 ? exact : candidates(listsDeployment);
    const chosen =
      matches.find((m) => m.provider === onSession) ??
      (byDefault && matches.find((m) => m.provider === byDefault)) ??
      (matches.length === 1 ? matches[0] : undefined);
    if (chosen?.entries.length === 1) entry = chosen.entries[0]!;
    if (!entry) {
      const ids = (m: { provider: CatalogProvider; entries: CatalogEntry[] }) =>
        m.entries.map((e) => `${m.provider.alias}/${e.upstreamId}`).join(", ");
      return chosen
        ? {
            ok: false,
            status: 400,
            reason: `model '${bare}' is served by several ids on '${chosen.provider.alias}' (${ids(chosen)}); name one of them`,
          }
        : matches.length > 1
          ? {
              ok: false,
              status: 400,
              reason: `model '${bare}' is served by several providers (${matches.map(ids).join(", ")}); name one of them`,
            }
          : {
              ok: false,
              status: 404,
              reason: `no granted provider lists model '${bare}' for this harness (granted: ${known})`,
            };
    }
  }
  if (!entry.dialects.includes(dialect))
    return {
      ok: false,
      status: 400,
      reason: `provider '${entry.alias}' does not serve the ${dialect} API`,
    };
  if (entry.harnesses && !entry.harnesses.includes(input.harnessName ?? ""))
    return {
      ok: false,
      status: 400,
      reason: `provider '${entry.alias}' (${entry.template}) works from ${entry.harnesses.join(", ")} only, not from ${input.harnessName ?? "an unnamed harness"}`,
    };
  return { ok: true, entry, publicName: renderName(entry, harness) };
}

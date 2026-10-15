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

const listsBare = (
  p: CatalogProvider,
  bare: string,
): CatalogEntry | undefined =>
  p.entries.find((e) => e.upstreamId === bare) ??
  p.entries.find((e) => e.upstreamId.toLowerCase() === bare.toLowerCase());

function resolveQualified(
  parsed: { alias: ProviderAlias; upstreamId: string },
  providers: readonly CatalogProvider[],
): CatalogEntry | null {
  const provider = providers.find((p) => p.alias === parsed.alias);
  if (!provider) return null;
  return listsBare(provider, parsed.upstreamId) ?? null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a qualified name is matched case-insensitively
 * on the upstream id because Claude Code lowercases what it discovers. A bare
 * name is looked for on the session's provider, then the harness's default
 * provider, then the single provider that lists it; several candidates are
 * refused by name, so no call is billed to a provider the user did not pick.
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
    const listing = eligible.filter((p) => listsBare(p, bare));
    entry =
      (onSession && listsBare(onSession, bare)) ??
      (byDefault && listsBare(byDefault, bare)) ??
      (listing.length === 1 ? listsBare(listing[0]!, bare) : undefined) ??
      null;
    if (!entry) {
      return listing.length > 1
        ? {
            ok: false,
            status: 400,
            reason: `model '${bare}' is served by several providers (${listing.map((p) => p.alias).join(", ")}); name one as <alias>/${bare}`,
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

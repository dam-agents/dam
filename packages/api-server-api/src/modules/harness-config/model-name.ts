import {
  PROVIDER_ALIASES,
  type ProviderAlias,
} from "../connections/providers.js";

export interface QualifiedModel {
  alias: ProviderAlias;
  upstreamId: string;
}

export const CLAUDE_MODEL_NAME_PREFIX = "claude/";

export function formatQualifiedModel(
  alias: ProviderAlias,
  upstreamId: string,
): string {
  return `${alias}/${upstreamId}`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the upstream id may itself contain `/`, so only
 * the first segment is read as the alias. Claude Code sees every name as
 * `claude/<alias>/<id>`, which `claudePrefix` strips first. A bare name
 * parses to null, which is how callers tell the two apart.
 */
export function parseQualifiedModel(
  name: string | null | undefined,
  opts: { claudePrefix?: boolean } = {},
): QualifiedModel | null {
  if (!name) return null;
  const stripped =
    opts.claudePrefix && name.startsWith(CLAUDE_MODEL_NAME_PREFIX)
      ? name.slice(CLAUDE_MODEL_NAME_PREFIX.length)
      : name;
  const slash = stripped.indexOf("/");
  if (slash <= 0) return null;
  const alias = stripped.slice(0, slash);
  const upstreamId = stripped.slice(slash + 1);
  if (!upstreamId || !(PROVIDER_ALIASES as readonly string[]).includes(alias))
    return null;
  return { alias: alias as ProviderAlias, upstreamId };
}

export function isQualifiedModel(
  name: string | null | undefined,
  opts: { claudePrefix?: boolean } = {},
): boolean {
  return parseQualifiedModel(name, opts) !== null;
}

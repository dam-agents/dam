/** Parsing for the optional narrowing a `github-app` Connection may carry.
 *
 *  GitHub mints an installation token with the installation's full authority
 *  unless the request names a narrower set, so the scope is what the user asks
 *  for rather than what they are entitled to — GitHub rejects anything beyond
 *  the installation. Both fields arrive as single strings to keep the
 *  schema-driven forms all-string (same shape as client-credentials `scopes`).
 */

/** GitHub caps one installation-token request at 500 repositories. */
const MAX_REPOSITORIES = 500;

// Levels GitHub accepts for a fine-grained permission. `admin` is only valid
// for a handful of them; GitHub is the authority on which, and answers 422.
const PERMISSION_LEVELS = new Set(["read", "write", "admin"]);

// Repository *names*, not `owner/name` — the installation implies the owner.
const REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/;

// Permission keys are lower_snake_case in GitHub's schema (contents, pull_requests, …).
const PERMISSION_NAME = /^[a-z][a-z_]*$/;

export interface GitHubAppScope {
  repositories?: string[];
  repositoryIds?: number[];
  permissions?: Record<string, string>;
}

function split(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Repository names the token should be limited to. Blank means every
 *  repository the installation can reach. */
export function parseRepositories(
  raw: string | undefined,
): string[] | undefined {
  if (raw === undefined) return undefined;
  const names = split(raw);
  if (names.length === 0) return undefined;
  for (const name of names) {
    // The likely pastes are `owner/repo` and the repository's URL; say so
    // rather than letting GitHub 422. Only name the trailing segment when it
    // is itself usable — suggesting a value that fails again (or an empty one,
    // which would silently mean "no narrowing") is worse than not suggesting.
    if (name.includes("/")) {
      const suggestion = name.slice(name.lastIndexOf("/") + 1);
      throw new Error(
        REPOSITORY_NAME.test(suggestion)
          ? `Repository "${name}" must be just the repository name, without the owner — use "${suggestion}".`
          : `Repository "${name}" must be just the repository name, without the owner.`,
      );
    }
    if (!REPOSITORY_NAME.test(name)) {
      throw new Error(`Repository "${name}" is not a valid repository name.`);
    }
  }
  const unique = [...new Set(names)];
  if (unique.length > MAX_REPOSITORIES) {
    throw new Error(
      `A connection can name at most ${MAX_REPOSITORIES} repositories (got ${unique.length}).`,
    );
  }
  return unique;
}

/** `name:level` pairs — e.g. `contents:read, metadata:read`. Blank means every
 *  permission the installation holds. A later duplicate wins, so re-typing a
 *  permission corrects it rather than erroring. */
export function parsePermissions(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  const entries = split(raw);
  if (entries.length === 0) return undefined;
  const permissions: Record<string, string> = {};
  for (const entry of entries) {
    const sep = entry.indexOf(":");
    if (sep === -1) {
      throw new Error(
        `Permission "${entry}" must be written as name:level — e.g. contents:read.`,
      );
    }
    const name = entry.slice(0, sep);
    const level = entry.slice(sep + 1).toLowerCase();
    if (!PERMISSION_NAME.test(name)) {
      throw new Error(`Permission "${entry}" has an invalid permission name.`);
    }
    if (!PERMISSION_LEVELS.has(level)) {
      throw new Error(
        `Permission "${entry}" must end in :read, :write, or :admin.`,
      );
    }
    permissions[name] = level;
  }
  return permissions;
}

/** Repositories identified by GitHub's numeric id — what the installation
 *  picker records, since an id survives a repository rename. */
export function parseRepositoryIds(
  raw: string | undefined,
): number[] | undefined {
  if (raw === undefined) return undefined;
  const entries = split(raw);
  if (entries.length === 0) return undefined;
  const ids: number[] = [];
  for (const entry of entries) {
    // Guard the whole string: Number("12abc") is NaN but Number("12 ") is 12,
    // and a silently-truncated id would narrow to the wrong repository.
    if (!/^\d+$/.test(entry)) {
      throw new Error(`Repository id "${entry}" must be a whole number.`);
    }
    const id = Number(entry);
    if (!Number.isSafeInteger(id)) {
      throw new Error(`Repository id "${entry}" is out of range.`);
    }
    ids.push(id);
  }
  const unique = [...new Set(ids)];
  if (unique.length > MAX_REPOSITORIES) {
    throw new Error(
      `A connection can name at most ${MAX_REPOSITORIES} repositories (got ${unique.length}).`,
    );
  }
  return unique;
}

/** Each half narrows independently — naming only repositories still narrows the
 *  token, and so does naming only permissions. Repositories may arrive as ids
 *  (from the picker) or as names (typed, or from the CLI); GitHub takes one
 *  form or the other, so ids win and the names are dropped rather than sent
 *  alongside them. */
export function parseGitHubAppScope(input: {
  repositories?: string | undefined;
  repositoryIds?: string | undefined;
  permissions?: string | undefined;
}): GitHubAppScope {
  const repositoryIds = parseRepositoryIds(input.repositoryIds);
  const repositories = repositoryIds
    ? undefined
    : parseRepositories(input.repositories);
  const permissions = parsePermissions(input.permissions);
  return {
    ...(repositories ? { repositories } : {}),
    ...(repositoryIds ? { repositoryIds } : {}),
    ...(permissions ? { permissions } : {}),
  };
}

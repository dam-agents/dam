import type { FullAccessChoice, GithubAccess } from "./github-access.js";

const PERMISSION_LEVELS = ["read", "write", "admin"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export function levelsUpTo(granted: string): PermissionLevel[] {
  const ceiling = PERMISSION_LEVELS.indexOf(granted as PermissionLevel);
  if (ceiling < 0) return [];
  return PERMISSION_LEVELS.slice(0, ceiling + 1);
}

function split(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readPermissions(raw: string): Record<string, PermissionLevel> {
  const out: Record<string, PermissionLevel> = {};
  for (const entry of split(raw)) {
    const sep = entry.indexOf(":");
    if (sep < 1) continue;
    const name = entry.slice(0, sep);
    const level = entry.slice(sep + 1).toLowerCase();
    if ((PERMISSION_LEVELS as readonly string[]).includes(level)) {
      out[name] = level as PermissionLevel;
    }
  }
  return out;
}

export function writePermissions(
  selection: Record<string, PermissionLevel>,
): string {
  return Object.keys(selection)
    .sort()
    .map((name) => `${name}:${selection[name]}`)
    .join(" ");
}

export function readRepositoryIds(raw: string): number[] {
  return split(raw)
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

export function writeRepositoryIds(ids: readonly number[]): string {
  return [...ids].sort((a, b) => a - b).join(" ");
}

export interface UnlistedRepos {
  saved: number[];
  kept: number;
  dropped: number;
  droppedAll: boolean;
}

export function splitUnlistedRepos(
  ticked: ReadonlySet<number>,
  listing:
    | {
        repositories: readonly { id: number }[];
        repositoriesTruncated?: boolean;
        repositoriesUnavailable?: string;
      }
    | undefined,
): UnlistedRepos {
  if (!listing)
    return { saved: [...ticked], kept: 0, dropped: 0, droppedAll: false };
  const listed = new Set(listing.repositories.map((r) => r.id));
  const unlisted = [...ticked].filter((id) => !listed.has(id)).length;
  if (listing.repositoriesTruncated || listing.repositoriesUnavailable)
    return {
      saved: [...ticked],
      kept: unlisted,
      dropped: 0,
      droppedAll: false,
    };
  const saved = [...ticked].filter((id) => listed.has(id));
  return {
    saved,
    kept: 0,
    dropped: unlisted,
    droppedAll: unlisted > 0 && saved.length === 0,
  };
}

export function canProbe(
  fields: Record<string, string>,
  hostRequired = false,
): boolean {
  const needed = ["appId", "installationId", "privateKey"];
  if (hostRequired) needed.push("host");
  return needed.every((k) => (fields[k] ?? "").trim().length > 0);
}

export const NO_APP_SCOPE =
  "Choose at least one repository or permission, or pick full access.";

export interface AppScopeChoice {
  repositories?: string;
  repositoryIds?: string;
  permissions?: string;
}

export function appScopeChoice(selection: {
  access: GithubAccess;
  repositories: readonly string[];
  repositoryIds: readonly number[];
  permissions: Record<string, PermissionLevel>;
}): FullAccessChoice | AppScopeChoice | null {
  if (selection.access === "full") return { fullAccess: true };
  const repositories = selection.repositories.join(" ");
  const repositoryIds = writeRepositoryIds(selection.repositoryIds);
  const permissions = writePermissions(selection.permissions);
  if (!repositories && !repositoryIds && !permissions) return null;
  return {
    ...(repositories ? { repositories } : {}),
    ...(repositoryIds ? { repositoryIds } : {}),
    ...(permissions ? { permissions } : {}),
  };
}

export function appScopeFieldsChosen(fields: Record<string, string>): boolean {
  return ["repositories", "repositoryIds", "permissions"].some(
    (name) => (fields[name] ?? "").trim().length > 0,
  );
}

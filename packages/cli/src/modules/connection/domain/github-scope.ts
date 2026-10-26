import type {
  ConnectionView,
  GitHubAppInstallationProbe,
  GitHubUserTokenInstallation,
  GitHubUserTokenProbe,
} from "api-server-api";
import { err, ok, type Result } from "../../../result.js";

const USER_TOKEN_TEMPLATE_IDS = new Set(["github", "github-enterprise"]);

export function isGitHubUserTokenTemplate(templateId: string): boolean {
  return USER_TOKEN_TEMPLATE_IDS.has(templateId);
}

export interface ConnectionScope {
  restricted: boolean;
  fullAccess?: true;
  account?: string;
  accountId?: number;
  repositories?: string[];
  repositoryIds?: number[];
  permissions?: Record<string, string>;
}

export interface ScopeFlags {
  account?: string;
  repositories?: string;
  repositoryIds?: string;
  permissions?: string;
}

export type ScopeKind = "github-user-token" | "github-app";

export function scopeKindOf(view: ConnectionView): ScopeKind | undefined {
  if (view.authKind === "github-app") return "github-app";
  if (view.authKind === "oauth" && view.githubUserToken) {
    return "github-user-token";
  }
  return undefined;
}

export function scopeOf(view: ConnectionView): ConnectionScope | undefined {
  if (view.isParent) return undefined;
  const kind = scopeKindOf(view);
  if (kind && view.fullAccess) return { restricted: false, fullAccess: true };
  if (kind === "github-app") {
    const s = view.githubAppScope;
    if (!s) return { restricted: false };
    return {
      restricted: true,
      ...(s.repositoryIds?.length
        ? { repositoryIds: s.repositoryIds }
        : s.repositories?.length
          ? { repositories: s.repositories }
          : {}),
      ...(s.permissions && Object.keys(s.permissions).length > 0
        ? { permissions: s.permissions }
        : {}),
    };
  }
  if (kind === "github-user-token") {
    const s = view.githubUserToken?.scope;
    if (!s) return { restricted: false };
    return {
      restricted: true,
      ...(s.targetLogin ? { account: s.targetLogin } : {}),
      accountId: s.targetId,
      ...(s.repositoryNames?.length ? { repositories: s.repositoryNames } : {}),
      ...(s.repositoryIds?.length ? { repositoryIds: s.repositoryIds } : {}),
      ...(s.permissions && Object.keys(s.permissions).length > 0
        ? { permissions: s.permissions }
        : {}),
    };
  }
  return undefined;
}

export function fullAccessSummary(kind: ScopeKind | undefined): string {
  switch (kind) {
    case "github-user-token":
      return "FULL ACCESS — every account, repository and permission the sign-in reaches";
    case "github-app":
      return "FULL ACCESS — the whole installation, every repository and permission";
    case undefined:
      return "FULL ACCESS";
  }
}

export function formatScope(
  scope: ConnectionScope | undefined,
  kind?: ScopeKind,
): string {
  if (!scope) return "—";
  if (scope.fullAccess) return fullAccessSummary(kind);
  if (!scope.restricted) return "unrestricted";
  const parts: string[] = [];
  if (scope.account !== undefined || scope.accountId !== undefined) {
    parts.push(`account ${scope.account ?? `#${scope.accountId}`}`);
  }
  if (scope.repositories) parts.push(`repos ${scope.repositories.join(",")}`);
  else if (scope.repositoryIds) {
    parts.push(`repo ids ${scope.repositoryIds.join(",")}`);
  } else parts.push("all repos");
  parts.push(
    scope.permissions
      ? `perms ${writePermissions(scope.permissions).replace(/ /g, ",")}`
      : "all perms",
  );
  return parts.join("; ");
}

export function reachLines(
  available: GitHubUserTokenProbe | GitHubAppInstallationProbe,
): string[] {
  const lines: string[] = [];
  const installations =
    "installations" in available
      ? available.installations
      : [{ accountLogin: undefined, ...available }];
  if (installations.length === 0) {
    lines.push("The app is not installed on any account this sign-in reaches.");
  }
  for (const inst of installations) {
    lines.push(
      inst.accountLogin !== undefined
        ? `Account ${inst.accountLogin}:`
        : "Installation:",
    );
    lines.push(
      `  repositories: ${
        inst.repositoriesUnavailable
          ? `couldn't list (${inst.repositoriesUnavailable})`
          : inst.repositories.map((r) => `${r.name} (${r.id})`).join(", ") +
            (inst.repositoriesTruncated ? ", …" : "")
      }`,
    );
    lines.push(
      `  permissions: ${writePermissions(inst.permissions).replace(/ /g, ", ") || "none"}`,
    );
  }
  if (
    "installationsTruncated" in available &&
    available.installationsTruncated
  ) {
    lines.push("…and more installations than can be listed.");
  }
  return lines;
}

export function writePermissions(permissions: Record<string, string>): string {
  return Object.keys(permissions)
    .sort()
    .map((name) => `${name}:${permissions[name]}`)
    .join(" ");
}

function split(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const FULL_ACCESS_CONFLICT =
  "--full-access can't be combined with --account, --repositories, --repository-ids or --permissions";

export function hasScopeFlags(flags: ScopeFlags): boolean {
  return (
    flags.account !== undefined ||
    flags.repositories !== undefined ||
    flags.repositoryIds !== undefined ||
    flags.permissions !== undefined
  );
}

export interface UserTokenScopeInput {
  targetId?: number;
  repositoryIds?: string;
  permissions?: string;
}

export function resolveUserTokenScope(
  probe: GitHubUserTokenProbe,
  current: ConnectionScope | undefined,
  flags: ScopeFlags,
): Result<UserTokenScopeInput, string> {
  const installations = probe.installations;
  let installation: GitHubUserTokenInstallation | undefined;
  if (flags.account !== undefined) {
    const wanted = flags.account.trim().toLowerCase();
    installation = installations.find(
      (i) => i.accountLogin.toLowerCase() === wanted,
    );
    if (!installation) {
      return err(
        `the app is not installed on an account '${flags.account}' this sign-in reaches; ` +
          accountsHint(installations),
      );
    }
  } else if (current?.accountId !== undefined) {
    installation = installations.find((i) => i.targetId === current.accountId);
    if (!installation) {
      return err(
        `this connection is narrowed to ${current.account ?? `account #${current.accountId}`}, ` +
          "which the app is no longer installed on for this sign-in; pass --account. " +
          accountsHint(installations),
      );
    }
  } else if (installations.length === 1) {
    installation = installations[0];
  } else if (installations.length === 0) {
    return err(
      "the app is not installed on any account this sign-in reaches — install it on GitHub first",
    );
  } else {
    return err(`pass --account to choose one; ${accountsHint(installations)}`);
  }
  const target = installation!;

  const sameAccount = current?.accountId === target.targetId;
  let repositoryIds = sameAccount ? current?.repositoryIds : undefined;
  if (flags.repositoryIds !== undefined) {
    const ids = split(flags.repositoryIds);
    const bad = ids.find((s) => !/^\d+$/.test(s));
    if (bad !== undefined) {
      return err(`repository id '${bad}' must be a whole number`);
    }
    repositoryIds = ids.map(Number);
  } else if (flags.repositories !== undefined) {
    const resolved = repositoryIdsByName(target, split(flags.repositories));
    if (!resolved.ok) return resolved;
    repositoryIds = resolved.value;
  }
  const permissions =
    flags.permissions ??
    (sameAccount && current?.permissions
      ? writePermissions(current.permissions)
      : undefined);
  return ok({
    targetId: target.targetId,
    ...(repositoryIds?.length
      ? { repositoryIds: repositoryIds.join(" ") }
      : {}),
    ...(permissions?.trim() ? { permissions } : {}),
  });
}

function repositoryIdsByName(
  installation: GitHubUserTokenInstallation,
  names: readonly string[],
): Result<number[], string> {
  if (names.length === 0) return ok([]);
  if (installation.repositoriesUnavailable) {
    return err(
      `couldn't list ${installation.accountLogin}'s repositories ` +
        `(${installation.repositoriesUnavailable}); pass --repository-ids instead`,
    );
  }
  const byName = new Map(
    installation.repositories.map((r) => [r.name.toLowerCase(), r.id]),
  );
  const ids: number[] = [];
  for (const raw of names) {
    const name = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
    const id = byName.get(name.toLowerCase());
    if (id === undefined) {
      return err(
        `the app's installation on ${installation.accountLogin} has no repository '${raw}'` +
          (installation.repositoriesTruncated
            ? " in the repositories it could list; pass --repository-ids for it"
            : ""),
      );
    }
    ids.push(id);
  }
  return ok([...new Set(ids)]);
}

function accountsHint(
  installations: readonly GitHubUserTokenInstallation[],
): string {
  if (installations.length === 0) {
    return "the app is not installed on any account this sign-in reaches";
  }
  return `accounts: ${installations.map((i) => i.accountLogin).join(", ")}`;
}

export interface AppScopeInput {
  repositories?: string;
  repositoryIds?: string;
  permissions?: string;
}

export interface SentScope extends AppScopeInput {
  fullAccess?: boolean;
  targetId?: number;
}

export function limitsAppScope(input: AppScopeInput): boolean {
  return [input.repositories, input.repositoryIds, input.permissions].some(
    (v) => v !== undefined && split(v).length > 0,
  );
}

export function sentReach(sent: SentScope): boolean {
  return (
    sent.fullAccess === true ||
    sent.targetId !== undefined ||
    limitsAppScope(sent)
  );
}

export function scopeOfSent(sent: SentScope): ConnectionScope {
  if (sent.fullAccess) return { restricted: false, fullAccess: true };
  const repositoryIds = split(sent.repositoryIds ?? "").map(Number);
  const repositories = split(sent.repositories ?? "");
  const permissions = Object.fromEntries(
    split(sent.permissions ?? "").map((pair) => {
      const [name = "", level = ""] = pair.split(":");
      return [name, level];
    }),
  );
  return {
    restricted: true,
    ...(sent.targetId !== undefined ? { accountId: sent.targetId } : {}),
    ...(repositoryIds.length > 0
      ? { repositoryIds }
      : repositories.length > 0
        ? { repositories }
        : {}),
    ...(Object.keys(permissions).length > 0 ? { permissions } : {}),
  };
}

export function resolveAppScope(
  current: ConnectionScope | undefined,
  flags: ScopeFlags,
): Result<AppScopeInput, string> {
  if (flags.account !== undefined) {
    return err(
      "--account narrows a GitHub sign-in; a GitHub App connection reaches one installation already",
    );
  }
  const repos: AppScopeInput =
    flags.repositoryIds !== undefined
      ? { repositoryIds: flags.repositoryIds }
      : flags.repositories !== undefined
        ? { repositories: flags.repositories }
        : current?.repositoryIds
          ? { repositoryIds: current.repositoryIds.join(" ") }
          : current?.repositories
            ? { repositories: current.repositories.join(" ") }
            : {};
  const permissions =
    flags.permissions ??
    (current?.permissions ? writePermissions(current.permissions) : undefined);
  const scope = { ...repos, ...(permissions?.trim() ? { permissions } : {}) };
  if (!limitsAppScope(scope)) {
    return err(
      "that leaves the connection without any limit; name the repositories or permissions it reaches, " +
        "or pass --full-access for the whole installation",
    );
  }
  return ok(scope);
}

import type {
  Connection,
  ConnectionAuthConfig,
  GitHubUserTokenScope,
  SecretRef,
} from "api-server-api";
import type { GitHubAppScope } from "./github-app-scope.js";
import { supportsGitHubUserTokenScope } from "./github-user-token-scope.js";

const GITHUB_APP_TEMPLATE_IDS = new Set([
  "github-app",
  "github-enterprise-app",
]);

export function splitsIntoParent(
  templateId: string,
  authKind: ConnectionAuthConfig["kind"],
): boolean {
  return (
    (authKind === "oauth" && supportsGitHubUserTokenScope(templateId)) ||
    (authKind === "github-app" && GITHUB_APP_TEMPLATE_IDS.has(templateId))
  );
}

export function isGrantable(conn: Pick<Connection, "isParent">): boolean {
  return conn.isParent !== true;
}

export function hasAppScope(scope: GitHubAppScope): boolean {
  return (
    scope.repositories !== undefined ||
    scope.repositoryIds !== undefined ||
    scope.permissions !== undefined
  );
}

type OAuthAuth = Extract<ConnectionAuthConfig, { kind: "oauth" }>;
type GitHubAppAuth = Extract<ConnectionAuthConfig, { kind: "github-app" }>;

export type ChildScope =
  | { fullAccess: true }
  | { userTokenScope: GitHubUserTokenScope }
  | { appScope: GitHubAppScope };

export function childScopeOf(input: {
  fullAccess?: boolean | undefined;
  userTokenScope?: GitHubUserTokenScope | undefined;
  appScope?: GitHubAppScope | undefined;
}): ChildScope {
  const narrowed =
    input.userTokenScope !== undefined ||
    (input.appScope !== undefined && hasAppScope(input.appScope));
  if (input.fullAccess && narrowed) {
    throw new Error(
      "Choose either full access or the repositories and permissions, not both.",
    );
  }
  if (input.fullAccess) return { fullAccess: true };
  if (input.userTokenScope) return { userTokenScope: input.userTokenScope };
  if (input.appScope && hasAppScope(input.appScope)) {
    return { appScope: input.appScope };
  }
  throw new Error(
    "Choose what this connection reaches — an account, repositories and permissions — or pick full access.",
  );
}

export function withoutScope<A extends OAuthAuth | GitHubAppAuth>(auth: A): A {
  const next = { ...auth };
  delete next.fullAccess;
  if (next.kind === "oauth") {
    delete next.githubUserTokenScope;
  } else {
    delete next.repositories;
    delete next.repositoryIds;
    delete next.permissions;
  }
  return next;
}

export function withoutParentScope<A extends OAuthAuth | GitHubAppAuth>(
  conn: Pick<Connection, "isParent">,
  auth: A,
): A {
  return conn.isParent ? withoutScope(auth) : auth;
}

export function withScope<A extends OAuthAuth | GitHubAppAuth>(
  auth: A,
  scope: ChildScope,
): A {
  const next = withoutScope(auth);
  if ("fullAccess" in scope) return { ...next, fullAccess: true };
  if ("userTokenScope" in scope && next.kind === "oauth") {
    return { ...next, githubUserTokenScope: scope.userTokenScope };
  }
  if ("appScope" in scope && next.kind === "github-app") {
    return { ...next, ...scope.appScope };
  }
  throw new Error(`a ${next.kind} scope does not fit this connection`);
}

export function childAuthOf(
  parent: ConnectionAuthConfig,
  scope: ChildScope,
  tokenRef: SecretRef,
  connectedAt: number,
): OAuthAuth | GitHubAppAuth {
  if (parent.kind !== "oauth" && parent.kind !== "github-app") {
    throw new Error(
      `a ${parent.kind} connection has no connections made from it`,
    );
  }
  const base = { ...withoutScope(parent), accessTokenRef: tokenRef };
  delete base.expiresAt;
  delete base.refreshFailedAt;
  delete base.refreshBackoff;
  if (base.kind === "oauth") delete base.refreshTokenRef;
  return withScope({ ...base, connectedAt }, scope);
}

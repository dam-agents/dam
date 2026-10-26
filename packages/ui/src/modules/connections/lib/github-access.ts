import type { ConnectionView } from "api-server-api";
import { match } from "ts-pattern";

export type GithubAccess = "narrowed" | "full";

export type GithubCredentialKind = "sign-in" | "installation";

export function githubCredentialKind(
  connection: Pick<ConnectionView, "authKind">,
): GithubCredentialKind {
  return match(connection.authKind)
    .with("github-app", () => "installation" as const)
    .with(
      "oauth",
      "client-credentials",
      "header",
      "sigv4",
      "none",
      () => "sign-in" as const,
    )
    .exhaustive();
}

export interface FullAccessChoice {
  fullAccess: true;
}

export const FULL_ACCESS_LABEL = "Full access";

export function fullAccessReach(
  connection: Pick<ConnectionView, "authKind">,
): string {
  return match(githubCredentialKind(connection))
    .with("installation", () => "the whole installation")
    .with("sign-in", () => "everything the app can reach on every account")
    .exhaustive();
}

export function fullAccessLine(
  connection: Pick<ConnectionView, "authKind">,
): string {
  return `${FULL_ACCESS_LABEL} — ${fullAccessReach(connection)}`;
}

const NAMES_SHOWN = 3;

function repositoriesPhrase(
  names: readonly string[] | undefined,
  count: number,
): string {
  if (names && names.length > 0) {
    const shown = names.slice(0, NAMES_SHOWN).join(", ");
    const more = names.length - NAMES_SHOWN;
    return more > 0 ? `${shown} and ${more} more` : shown;
  }
  if (count === 0) return "all repositories";
  return `${count} ${count === 1 ? "repository" : "repositories"}`;
}

function permissionsPhrase(
  permissions: Record<string, string> | undefined,
): string {
  const names = Object.keys(permissions ?? {}).sort();
  if (names.length === 0) return "all permissions";
  return names.map((name) => `${name}: ${permissions![name]}`).join(", ");
}

type ScopedConnection = Pick<
  ConnectionView,
  "fullAccess" | "githubUserToken" | "githubAppScope" | "check"
>;

export function connectionScopeSummary(
  connection: ScopedConnection,
): string | null {
  if (connection.fullAccess) return null;
  const userScope = connection.githubUserToken?.scope;
  if (userScope) {
    return [
      userScope.targetLogin ?? `account ${userScope.targetId}`,
      repositoriesPhrase(
        userScope.repositoryNames,
        userScope.repositoryIds?.length ?? 0,
      ),
      permissionsPhrase(userScope.permissions),
    ].join(" · ");
  }
  const appScope = connection.githubAppScope;
  if (!appScope) return null;
  const installedOn = connection.check?.installedOn;
  const scope = appScopePhrase(appScope, connection.check?.repositories);
  return installedOn ? `${installedOn} · ${scope}` : scope;
}

export function appScopePhrase(
  scope: {
    repositories?: readonly string[];
    repositoryIds?: readonly number[];
    permissions?: Record<string, string>;
  },
  reachedNames?: readonly string[],
): string {
  const idCount = scope.repositoryIds?.length ?? 0;
  const names = scope.repositories ?? (idCount > 0 ? reachedNames : undefined);
  return [
    repositoriesPhrase(names, idCount),
    permissionsPhrase(scope.permissions),
  ].join(" · ");
}

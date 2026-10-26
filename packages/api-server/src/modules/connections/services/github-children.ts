import type {
  Connection,
  ConnectionAuthConfig,
  GitHubUserTokenScope,
} from "api-server-api";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type { SecretStore } from "../../secret-store/index.js";
import { buildConnectionSdsFields } from "../domain/connection-sds.js";
import {
  earliestExpiry,
  gitHubUserTokenApiBase,
} from "../domain/github-user-token-scope.js";
import { withoutRefreshFailureMarker } from "../domain/refresh-failure-marker.js";
import { scopeGitHubUserToken } from "./github-user-token.js";
import { securityLog } from "../../../core/security-log.js";

// UNIT_BOUNDARY_DESCRIPTION: the connections made from a GitHub sign-in hold no token of their own to renew: each one injects the sign-in's user token for full access, or the token GitHub derives from it for its scope. After the sign-in's user token changes, under the sign-in's refresh lock, every one of them gets a token from the new one. A connection whose scope GitHub refuses reads expired and the others are still renewed, so one connection's narrowing never costs its siblings their access.
type OAuthAuth = Extract<ConnectionAuthConfig, { kind: "oauth" }>;

export interface ChildTokenDeps {
  repo: Pick<ConnectionsRepository, "listChildren" | "updateAuth">;
  secretStore: SecretStore;
  githubAppEngine: GitHubAppEngine;
}

export interface UserToken {
  accessToken: string;
  expiresAt?: number | undefined;
}

export async function childUserToken(
  deps: Pick<ChildTokenDeps, "githubAppEngine">,
  child: Pick<Connection, "id" | "templateId">,
  auth: OAuthAuth,
  userToken: UserToken,
  clientSecret: string | undefined,
): Promise<{ accessToken: string; expiresAt?: number; accountLogin?: string }> {
  const scope = auth.githubUserTokenScope;
  if (!scope) {
    if (!auth.fullAccess) {
      throw new Error(
        `connection ${child.id} names neither a scope nor full access`,
      );
    }
    return {
      accessToken: userToken.accessToken,
      ...(userToken.expiresAt !== undefined
        ? { expiresAt: userToken.expiresAt }
        : {}),
    };
  }
  const scoped = await scopeGitHubUserToken(deps.githubAppEngine, {
    connectionRef: `connection:${child.id}:${child.templateId}`,
    auth,
    scope,
    clientSecret,
    accessToken: userToken.accessToken,
  });
  const expiresAt = earliestExpiry(userToken.expiresAt, scoped.expiresAt);
  return {
    accessToken: scoped.accessToken,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(scoped.accountLogin ? { accountLogin: scoped.accountLogin } : {}),
  };
}

export async function writeChildToken(
  secretStore: SecretStore,
  child: Pick<Connection, "contributions">,
  auth: OAuthAuth,
  token: string,
): Promise<void> {
  await secretStore.putFields(auth.accessTokenRef, {
    [auth.accessTokenRef.field]: token,
    ...buildConnectionSdsFields(child.contributions, token),
  });
}

export async function describedUserTokenScope(
  engine: GitHubAppEngine,
  connectionRef: string,
  auth: OAuthAuth,
  scope: GitHubUserTokenScope,
  userToken: string,
  accountLogin: string | undefined,
): Promise<GitHubUserTokenScope> {
  const described: GitHubUserTokenScope = {
    ...scope,
    ...(accountLogin ? { targetLogin: accountLogin } : {}),
  };
  delete described.repositoryNames;
  const ids = scope.repositoryIds;
  if (!ids) return described;
  try {
    const probe = await engine.readUserInstallations({
      id: connectionRef,
      apiBaseUrl: gitHubUserTokenApiBase(auth.host),
      accessToken: userToken,
    });
    const names = new Map(
      (
        probe.installations.find((i) => i.targetId === scope.targetId)
          ?.repositories ?? []
      ).map((r) => [r.id, r.name] as const),
    );
    const repositoryNames = ids.flatMap((id) => {
      const name = names.get(id);
      return name ? [name] : [];
    });
    return repositoryNames.length === ids.length
      ? { ...described, repositoryNames }
      : described;
  } catch {
    return described;
  }
}

export async function rederiveGitHubChildren(
  deps: ChildTokenDeps,
  parent: Connection,
  userToken: UserToken,
  clientSecret: string | undefined,
): Promise<number | undefined> {
  let earliest = userToken.expiresAt;
  for (const child of await deps.repo.listChildren(parent.id)) {
    if (child.auth.kind !== "oauth") continue;
    const auth = child.auth;
    try {
      const next = await childUserToken(
        deps,
        child,
        auth,
        userToken,
        clientSecret,
      );
      await writeChildToken(deps.secretStore, child, auth, next.accessToken);
      const renewed: OAuthAuth = { ...withoutRefreshFailureMarker(auth) };
      delete renewed.expiresAt;
      await deps.repo.updateAuth(child.id, {
        ...renewed,
        connectedAt: auth.connectedAt ?? Math.floor(Date.now() / 1000),
        ...(next.expiresAt !== undefined ? { expiresAt: next.expiresAt } : {}),
      });
      earliest = earliestExpiry(earliest, next.expiresAt);
    } catch (err) {
      await deps.repo.updateAuth(child.id, {
        ...auth,
        refreshFailedAt: Math.floor(Date.now() / 1000),
      });
      securityLog("warn", "connection.child_token_failed", {
        category: "credential",
        actor: "system:oauth-refresh",
        actorKind: "system",
        target: child.id,
        result: "failure",
        detail: {
          parentId: parent.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
  return earliest;
}

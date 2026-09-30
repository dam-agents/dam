import type {
  ConnectionAuthConfig,
  GitHubUserTokenScope,
} from "api-server-api";
import type {
  GitHubAppEngine,
  GitHubUserTokenSet,
} from "../infrastructure/github-app-engine.js";
import { gitHubUserTokenApiBase } from "../domain/github-user-token-scope.js";

type OAuthAuth = Extract<ConnectionAuthConfig, { kind: "oauth" }>;

export async function scopeGitHubUserToken(
  engine: GitHubAppEngine,
  opts: {
    connectionRef: string;
    auth: OAuthAuth;
    scope: GitHubUserTokenScope;
    clientSecret: string | undefined;
    accessToken: string;
  },
): Promise<GitHubUserTokenSet> {
  if (!opts.clientSecret) {
    throw new Error(
      `${opts.connectionRef}: narrowing a GitHub user token needs the GitHub App's client secret, and none is configured`,
    );
  }
  return engine.scopeUserToken({
    id: opts.connectionRef,
    apiBaseUrl: gitHubUserTokenApiBase(opts.auth.host),
    clientId: opts.auth.clientId,
    clientSecret: opts.clientSecret,
    accessToken: opts.accessToken,
    targetId: opts.scope.targetId,
    ...(opts.scope.repositoryIds
      ? { repositoryIds: opts.scope.repositoryIds }
      : {}),
    ...(opts.scope.permissions ? { permissions: opts.scope.permissions } : {}),
  });
}

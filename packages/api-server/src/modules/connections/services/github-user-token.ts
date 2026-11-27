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

/** The app a GitHub user token was issued to: its client ID and secret. */
export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
}

export async function scopeGitHubUserToken(
  engine: GitHubAppEngine,
  opts: {
    connectionRef: string;
    auth: OAuthAuth;
    scope: GitHubUserTokenScope;
    client: OAuthClient;
    accessToken: string;
  },
): Promise<GitHubUserTokenSet> {
  const { clientId, clientSecret } = opts.client;
  if (!clientSecret) {
    throw new Error(
      `${opts.connectionRef}: narrowing a GitHub user token needs the GitHub App's client secret, and none is configured`,
    );
  }
  return engine.scopeUserToken({
    id: opts.connectionRef,
    apiBaseUrl: gitHubUserTokenApiBase(opts.auth.host),
    clientId,
    clientSecret,
    accessToken: opts.accessToken,
    targetId: opts.scope.targetId,
    ...(opts.scope.repositoryIds
      ? { repositoryIds: opts.scope.repositoryIds }
      : {}),
    ...(opts.scope.permissions ? { permissions: opts.scope.permissions } : {}),
  });
}

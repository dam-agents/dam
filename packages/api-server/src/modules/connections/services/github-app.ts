import type { ConnectionAuthConfig } from "api-server-api";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";

export type GitHubAppAuth = Extract<
  ConnectionAuthConfig,
  { kind: "github-app" }
>;

export function gitHubAppMintLockKey(connectionId: string): string {
  return `github-app-mint:${connectionId}`;
}

export async function mintGitHubAppToken(
  engine: GitHubAppEngine,
  opts: {
    connectionRef: string;
    auth: GitHubAppAuth;
    privateKeyPem: string;
  },
): Promise<{ accessToken: string; expiresAt: number }> {
  return engine.mintInstallationToken({
    id: opts.connectionRef,
    appId: opts.auth.appId,
    installationId: opts.auth.installationId,
    privateKeyPem: opts.privateKeyPem,
    apiBaseUrl: opts.auth.apiBaseUrl,
    ...(opts.auth.repositories ? { repositories: opts.auth.repositories } : {}),
    ...(opts.auth.repositoryIds
      ? { repositoryIds: opts.auth.repositoryIds }
      : {}),
    ...(opts.auth.permissions ? { permissions: opts.auth.permissions } : {}),
  });
}

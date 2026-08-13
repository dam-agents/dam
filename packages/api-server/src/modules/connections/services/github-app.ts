import type { ConnectionAuthConfig } from "api-server-api";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";

export type GitHubAppAuth = Extract<
  ConnectionAuthConfig,
  { kind: "github-app" }
>;

/** Critical section covering one connection's mint → token write → auth write.
 *  A scope edit and the refresh loop's re-mint both run that sequence against
 *  the same token and the same row, and the token lives in a store no database
 *  transaction can bind — so interleaving them can leave the stored scope and
 *  the live token describing different authority. Both sides take this. */
export function gitHubAppMintLockKey(connectionId: string): string {
  return `github-app-mint:${connectionId}`;
}

/** One installation-token exchange, shared by connection create, private-key
 *  rotation, and the refresh loop. Maps the stored auth config onto the engine's
 *  mint call; `expiresAt` is always set (the engine falls back to a 1h horizon).
 *
 *  The stored scope is read here rather than passed in, so every re-mint asks
 *  for the same subset the connection was created with. */
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

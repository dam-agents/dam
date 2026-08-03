import type { ConnectionAuthConfig } from "api-server-api";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";

export type GitHubAppAuth = Extract<
  ConnectionAuthConfig,
  { kind: "github-app" }
>;

/** One installation-token exchange, shared by connection create and the refresh
 *  loop. Maps the stored auth config onto the engine's mint call; `expiresAt` is
 *  always set (the engine falls back to a 1h horizon). */
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
  });
}

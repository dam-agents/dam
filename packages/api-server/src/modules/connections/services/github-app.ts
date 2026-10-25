import type { ConnectionAuthConfig } from "api-server-api";
import type { CredentialProbeOutcome } from "../domain/credential-check.js";
import { tokenRejectionOf } from "../domain/refresh-failure-marker.js";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";
import { stripControlChars } from "../infrastructure/github-identity.js";

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

export async function describeGitHubAppToken(
  engine: GitHubAppEngine,
  opts: {
    connectionRef: string;
    auth: GitHubAppAuth;
    privateKeyPem: string;
    accessToken: string;
  },
): Promise<CredentialProbeOutcome> {
  const owner = await engine.describeInstallationToken({
    id: opts.connectionRef,
    appId: opts.auth.appId,
    installationId: opts.auth.installationId,
    privateKeyPem: opts.privateKeyPem,
    apiBaseUrl: opts.auth.apiBaseUrl,
    accessToken: opts.accessToken,
  });
  return {
    status: "passed",
    ...(owner.appSlug ? { account: `${owner.appSlug}[bot]` } : {}),
    ...(owner.accountLogin ? { installedOn: owner.accountLogin } : {}),
    ...(owner.repositories ? { repositories: owner.repositories } : {}),
    ...(owner.repositoriesTruncated ? { repositoriesTruncated: true } : {}),
  };
}

const REFUSED_STATUSES = new Set([401, 403, 404, 422]);

function mintFailure(err: unknown): CredentialProbeOutcome {
  const rejection = tokenRejectionOf(err);
  if (!rejection) {
    return err instanceof Error && err.message.includes("could not sign")
      ? { status: "failed", reason: "the stored private key cannot sign a JWT" }
      : { status: "unchecked", reason: "GitHub could not be reached" };
  }
  const status = rejection.status ?? 0;
  if (!REFUSED_STATUSES.has(status)) {
    return {
      status: "unchecked",
      reason: `GitHub answered HTTP ${status}, which says nothing about the app's credentials`,
    };
  }
  return {
    status: "failed",
    reason: stripControlChars(
      rejection.userMessage ??
        `GitHub refused to mint an installation token (HTTP ${status})`,
    ),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: Checks a stored GitHub App connection the way its agents use it: it mints an installation token for the connection's scope, reads who the token acts as and which repositories it reaches, and revokes the token again, since the connection keeps its own. A 401, 403, 404 or 422, or a key that cannot sign, fails with the input GitHub rejected; any other answer or no answer leaves it unchecked.
export async function checkGitHubApp(
  engine: GitHubAppEngine,
  opts: {
    connectionRef: string;
    auth: GitHubAppAuth;
    privateKeyPem: string;
  },
): Promise<CredentialProbeOutcome> {
  let accessToken: string;
  try {
    ({ accessToken } = await mintGitHubAppToken(engine, opts));
  } catch (err) {
    return mintFailure(err);
  }
  try {
    return await describeGitHubAppToken(engine, { ...opts, accessToken });
  } finally {
    await engine.revokeInstallationToken({
      apiBaseUrl: opts.auth.apiBaseUrl,
      accessToken,
    });
  }
}

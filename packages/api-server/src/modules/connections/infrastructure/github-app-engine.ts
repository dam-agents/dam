import crypto from "node:crypto";
import { OAuthTokenEndpointError } from "./oauth-engine.js";

export interface GitHubAppTokenSet {
  /** The installation access token (`ghs_…`). */
  accessToken: string;
  /** Unix seconds. Always set — from GitHub's `expires_at`, or the 1h fallback. */
  expiresAt: number;
}

export interface MintInstallationTokenOpts {
  /** Connection ref, used only in error messages. */
  id: string;
  /** The JWT issuer — a GitHub App's numeric App ID or its client id. */
  appId: string;
  installationId: string;
  /** PEM-encoded RSA private key generated for the app. */
  privateKeyPem: string;
  /** GitHub REST base the installation-token endpoint hangs off (no trailing slash needed). */
  apiBaseUrl: string;
  /** Repository names the token should be limited to. Omit for every
   *  repository the installation can reach. */
  repositories?: string[];
  /** Fine-grained permissions the token should carry, as name → level. Omit
   *  for every permission the installation holds. */
  permissions?: Record<string, string>;
}

export interface GitHubAppEngine {
  mintInstallationToken(
    opts: MintInstallationTokenOpts,
  ): Promise<GitHubAppTokenSet>;
}

export interface CreateGitHubAppEngineOptions {
  now?: () => number;
  fetchImpl?: typeof fetch;
  /** GitHub requires a User-Agent on API calls. */
  userAgent?: string;
}

// Installation tokens live one hour. GitHub always returns `expires_at`; the
// fallback only guards a malformed response so the refresh loop still has a
// horizon to re-mint against rather than trusting the token forever.
export const GITHUB_APP_DEFAULT_TTL_SECONDS = 3600;

// App JWTs may live at most 10 minutes; back-date `iat` a minute to tolerate
// clock skew between the platform and GitHub (per GitHub's guidance).
const JWT_LIFETIME_SECONDS = 600;
const JWT_CLOCK_SKEW_SECONDS = 60;

interface InstallationTokenResponse {
  token?: string;
  expires_at?: string;
}

/** Mints GitHub App installation access tokens. Unlike OAuth this is a bespoke
 *  GitHub flow — a self-signed RS256 JWT exchanged for a short-lived `ghs_`
 *  token — so it lives apart from the OAuth engine. */
export function createGitHubAppEngine(
  opts?: CreateGitHubAppEngineOptions,
): GitHubAppEngine {
  const now = opts?.now ?? (() => Date.now());
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const userAgent = opts?.userAgent ?? "dam-agent-platform";

  function signAppJwt(
    id: string,
    appId: string,
    privateKeyPem: string,
  ): string {
    const nowSec = Math.floor(now() / 1000);
    const b64url = (obj: unknown): string =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iat: nowSec - JWT_CLOCK_SKEW_SECONDS,
      exp: nowSec + JWT_LIFETIME_SECONDS,
      iss: appId,
    };
    const signingInput = `${b64url(header)}.${b64url(payload)}`;
    let signature: Buffer;
    try {
      signature = crypto.sign(
        "RSA-SHA256",
        Buffer.from(signingInput),
        privateKeyPem,
      );
    } catch (err) {
      throw new Error(
        `GitHub App ${id}: could not sign the app JWT — check the private key is a valid PEM (${(err as Error).message})`,
      );
    }
    return `${signingInput}.${signature.toString("base64url")}`;
  }

  return {
    async mintInstallationToken({
      id,
      appId,
      installationId,
      privateKeyPem,
      apiBaseUrl,
      repositories,
      permissions,
    }): Promise<GitHubAppTokenSet> {
      const jwt = signAppJwt(id, appId, privateKeyPem);
      const url = `${apiBaseUrl.replace(/\/+$/, "")}/app/installations/${encodeURIComponent(installationId)}/access_tokens`;
      // Omitting the body entirely is what grants the installation's full
      // authority, so an unscoped connection must send no body at all — an
      // empty list or object would be a different request, not the same one.
      const scope = {
        ...(repositories?.length ? { repositories } : {}),
        ...(permissions && Object.keys(permissions).length
          ? { permissions }
          : {}),
      };
      const scoped = Object.keys(scope).length > 0;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": userAgent,
          ...(scoped ? { "Content-Type": "application/json" } : {}),
        },
        ...(scoped ? { body: JSON.stringify(scope) } : {}),
      });
      if (!res.ok) {
        const txt = await res.text();
        // REST, not OAuth, so there is no error code to carry: translate the
        // dead ends into the classifier's vocabulary so the loop parks them.
        // 401 = key rejected, 404 = app/installation gone — both about the
        // client's own credential.
        const clientRejected = res.status === 401 || res.status === 404;
        // 422 answers a scoped request that asks for a repository or permission
        // the installation no longer covers. Retrying re-sends the same losing
        // request, so park it — but only when we actually asked for a subset;
        // an unscoped 422 is not about the scope and stays retryable.
        const scopeRejected = scoped && res.status === 422;
        throw new OAuthTokenEndpointError(
          `GitHub App ${id}: installation-token request failed — ${res.status} ${txt.slice(0, 500)}`,
          {
            status: res.status,
            ...(clientRejected ? { oauthError: "invalid_client" } : {}),
            ...(scopeRejected ? { oauthError: "invalid_grant" } : {}),
          },
        );
      }
      const data = (await res.json()) as InstallationTokenResponse;
      if (!data.token) {
        throw new Error(
          `GitHub App ${id}: installation-token response contained no token`,
        );
      }
      const fallback =
        Math.floor(now() / 1000) + GITHUB_APP_DEFAULT_TTL_SECONDS;
      const parsed = data.expires_at
        ? Math.floor(Date.parse(data.expires_at) / 1000)
        : fallback;
      return {
        accessToken: data.token,
        expiresAt: Number.isFinite(parsed) ? parsed : fallback,
      };
    },
  };
}

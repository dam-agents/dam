import crypto from "node:crypto";
import { OAuthTokenEndpointError } from "./oauth-engine.js";

export interface GitHubAppTokenSet {
  accessToken: string;
  expiresAt: number;
}

export interface MintInstallationTokenOpts {
  id: string;
  appId: string;
  installationId: string;
  privateKeyPem: string;
  apiBaseUrl: string;
  repositories?: string[];
  repositoryIds?: number[];
  permissions?: Record<string, string>;
}

export interface ReadInstallationOpts {
  id: string;
  appId: string;
  installationId: string;
  privateKeyPem: string;
  apiBaseUrl: string;
}

export interface GitHubAppInstallationInfo {
  permissions: Record<string, string>;
  repositories: { id: number; name: string }[];
  repositorySelection: "all" | "selected";
  accountLogin?: string;
  repositoriesUnavailable?: string;
  repositoriesTruncated?: boolean;
}

export interface GitHubAppEngine {
  mintInstallationToken(
    opts: MintInstallationTokenOpts,
  ): Promise<GitHubAppTokenSet>;
  readInstallation(
    opts: ReadInstallationOpts,
  ): Promise<GitHubAppInstallationInfo>;
}

export interface CreateGitHubAppEngineOptions {
  now?: () => number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export const GITHUB_APP_DEFAULT_TTL_SECONDS = 3600;

const JWT_LIFETIME_SECONDS = 600;
const JWT_CLOCK_SKEW_SECONDS = 60;

interface InstallationTokenResponse {
  token?: string;
  expires_at?: string;
}

interface InstallationResponse {
  permissions?: Record<string, string>;
  repository_selection?: string;
  account?: { login?: string };
}

interface InstallationRepositoriesResponse {
  repositories?: { id?: number; name?: string }[];
}

const REPOS_PER_PAGE = 100;
const MAX_REPO_PAGES = 5;

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

  async function mintInstallationToken({
    id,
    appId,
    installationId,
    privateKeyPem,
    apiBaseUrl,
    repositories,
    repositoryIds,
    permissions,
  }: MintInstallationTokenOpts): Promise<GitHubAppTokenSet> {
    const jwt = signAppJwt(id, appId, privateKeyPem);
    const url = `${apiBaseUrl.replace(/\/+$/, "")}/app/installations/${encodeURIComponent(installationId)}/access_tokens`;
    const scope = {
      ...(repositoryIds?.length
        ? { repository_ids: repositoryIds }
        : repositories?.length
          ? { repositories }
          : {}),
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
      const clientRejected = res.status === 401 || res.status === 404;
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
    const fallback = Math.floor(now() / 1000) + GITHUB_APP_DEFAULT_TTL_SECONDS;
    const parsed = data.expires_at
      ? Math.floor(Date.parse(data.expires_at) / 1000)
      : fallback;
    return {
      accessToken: data.token,
      expiresAt: Number.isFinite(parsed) ? parsed : fallback,
    };
  }

  async function listRepositories(opts: {
    id: string;
    appId: string;
    installationId: string;
    privateKeyPem: string;
    apiBaseUrl: string;
    base: string;
    asApp: () => Record<string, string>;
  }): Promise<{
    repositories: { id: number; name: string }[];
    truncated: boolean;
  }> {
    const { accessToken } = await mintInstallationToken({
      id: opts.id,
      appId: opts.appId,
      installationId: opts.installationId,
      privateKeyPem: opts.privateKeyPem,
      apiBaseUrl: opts.apiBaseUrl,
    });
    const asInstallation = {
      ...opts.asApp(),
      Authorization: `Bearer ${accessToken}`,
    };
    try {
      const repositories: { id: number; name: string }[] = [];
      let truncated = false;
      for (let page = 1; page <= MAX_REPO_PAGES; page++) {
        const listed = await fetchImpl(
          `${opts.base}/installation/repositories?per_page=${REPOS_PER_PAGE}&page=${page}`,
          { headers: asInstallation },
        );
        if (!listed.ok) {
          const txt = await listed.text();
          throw new OAuthTokenEndpointError(
            `GitHub App ${opts.id}: could not list the installation's repositories — ${listed.status} ${txt.slice(0, 500)}`,
            { status: listed.status },
          );
        }
        const body = (await listed.json()) as InstallationRepositoriesResponse;
        const batch = body.repositories ?? [];
        for (const repo of batch) {
          if (typeof repo.id === "number" && repo.name) {
            repositories.push({ id: repo.id, name: repo.name });
          }
        }
        if (batch.length < REPOS_PER_PAGE) break;
        if (page === MAX_REPO_PAGES) truncated = true;
      }
      return { repositories, truncated };
    } finally {
      try {
        await fetchImpl(`${opts.base}/installation/token`, {
          method: "DELETE",
          headers: asInstallation,
        });
      } catch {}
    }
  }

  return {
    mintInstallationToken,

    async readInstallation({
      id,
      appId,
      installationId,
      privateKeyPem,
      apiBaseUrl,
    }): Promise<GitHubAppInstallationInfo> {
      const base = apiBaseUrl.replace(/\/+$/, "");
      const jwt = signAppJwt(id, appId, privateKeyPem);
      const asApp = (): Record<string, string> => ({
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": userAgent,
      });

      const res = await fetchImpl(
        `${base}/app/installations/${encodeURIComponent(installationId)}`,
        { headers: asApp() },
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new OAuthTokenEndpointError(
          `GitHub App ${id}: could not read the installation — ${res.status} ${txt.slice(0, 500)}`,
          { status: res.status },
        );
      }
      const info = (await res.json()) as InstallationResponse;
      const repositorySelection =
        info.repository_selection === "all" ? "all" : "selected";
      const permissions = info.permissions ?? {};
      const accountLogin = info.account?.login;

      let repositories: { id: number; name: string }[] = [];
      let repositoriesTruncated = false;
      let repositoriesUnavailable: string | undefined;
      try {
        const listed = await listRepositories({
          id,
          appId,
          installationId,
          privateKeyPem,
          apiBaseUrl,
          base,
          asApp,
        });
        repositories = listed.repositories;
        repositoriesTruncated = listed.truncated;
      } catch (err) {
        repositoriesUnavailable =
          err instanceof Error ? err.message : "the list could not be read";
      }

      return {
        permissions,
        repositories,
        repositorySelection,
        ...(accountLogin ? { accountLogin } : {}),
        ...(repositoriesUnavailable ? { repositoriesUnavailable } : {}),
        ...(repositoriesTruncated ? { repositoriesTruncated: true } : {}),
      };
    },
  };
}

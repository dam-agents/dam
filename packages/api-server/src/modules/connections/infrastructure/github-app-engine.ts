import crypto from "node:crypto";
import type {
  GitHubUserTokenInstallation,
  GitHubUserTokenProbe,
} from "api-server-api";
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

export interface ScopeUserTokenOpts {
  id: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  targetId: number;
  repositoryIds?: number[];
  permissions?: Record<string, string>;
}

export interface GitHubUserTokenSet {
  accessToken: string;
  expiresAt?: number;
  accountLogin?: string;
}

export interface ReadUserInstallationsOpts {
  id: string;
  apiBaseUrl: string;
  accessToken: string;
}

export interface GitHubAppEngine {
  mintInstallationToken(
    opts: MintInstallationTokenOpts,
  ): Promise<GitHubAppTokenSet>;
  readInstallation(
    opts: ReadInstallationOpts,
  ): Promise<GitHubAppInstallationInfo>;
  scopeUserToken(opts: ScopeUserTokenOpts): Promise<GitHubUserTokenSet>;
  readUserInstallations(
    opts: ReadUserInstallationsOpts,
  ): Promise<GitHubUserTokenProbe>;
}

export interface CreateGitHubAppEngineOptions {
  now?: () => number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

const GITHUB_APP_DEFAULT_TTL_SECONDS = 3600;

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

interface ScopedTokenResponse {
  token?: string;
  expires_at?: string | null;
  installation?: { account?: { login?: string } } | null;
}

interface UserInstallationsResponse {
  installations?: {
    id?: number;
    target_id?: number;
    account?: { id?: number; login?: string } | null;
    permissions?: Record<string, string>;
    repository_selection?: string;
  }[];
}

const REPOS_PER_PAGE = 100;
const MAX_REPO_PAGES = 5;
const MAX_INSTALLATION_PAGES = 3;

async function reachGitHub(
  apiBaseUrl: string,
  request: () => Promise<Response>,
): Promise<Response> {
  try {
    return await request();
  } catch (err) {
    throw new Error(
      `Could not reach GitHub at ${apiBaseUrl} (${(err as Error).message}). Check the host name.`,
    );
  }
}

function githubErrorMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { message?: unknown };
    if (typeof json.message === "string") return json.message.trim();
  } catch {}
  return body.trim().slice(0, 200);
}

export function describeAppRejection(
  status: number,
  body: string,
  input: { appId: string; installationId: string; scoped: boolean },
): string | undefined {
  const message = githubErrorMessage(body);
  const said = message ? ` GitHub said: "${message}".` : "";
  if (status === 404 && /integration not found/i.test(message)) {
    return `The App ID is wrong: GitHub has no app with App ID ${input.appId}. Copy the App ID from the app's settings page (Settings → Developer settings → GitHub Apps → your app → General).`;
  }
  if (status === 404) {
    return `The Installation ID is wrong: the app with App ID ${input.appId} has no installation ${input.installationId}. Install the app on your organization or account first, then copy the number at the end of the installation's URL (…/settings/installations/<id>).`;
  }
  if (status === 401 && /\biss\b|issuer/i.test(message)) {
    return `The App ID is wrong: "${input.appId}" is not an App ID. The App ID is the number on the app's settings page (General → About), not the app's name.${said}`;
  }
  if (status === 401 && /could not be decoded/i.test(message)) {
    return `The private key does not belong to the app with App ID ${input.appId}. Check the App ID, or generate a private key on that app's settings page (General → Private keys) and paste the whole .pem file.`;
  }
  if (status === 401) {
    return `GitHub rejected the app's credentials. Check that the App ID and the private key come from the same app, and that the key has not been deleted from it.${said}`;
  }
  if (status === 403) {
    return `GitHub refused access to installation ${input.installationId}. Check that the installation is not suspended and that the app is still installed.${said}`;
  }
  if (status === 422 && input.scoped) {
    return `GitHub refused the repositories or permissions this connection is limited to. Choose only repositories the installation can reach and permissions the app has been granted.${said}`;
  }
  return undefined;
}

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
    const res = await reachGitHub(apiBaseUrl, () =>
      fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": userAgent,
          ...(scoped ? { "Content-Type": "application/json" } : {}),
        },
        ...(scoped ? { body: JSON.stringify(scope) } : {}),
      }),
    );
    if (!res.ok) {
      const txt = await res.text();
      const clientRejected = res.status === 401 || res.status === 404;
      const scopeRejected = scoped && res.status === 422;
      const userMessage = describeAppRejection(res.status, txt, {
        appId,
        installationId,
        scoped,
      });
      throw new OAuthTokenEndpointError(
        `GitHub App ${id}: installation-token request failed — ${res.status} ${txt.slice(0, 500)}`,
        {
          status: res.status,
          ...(clientRejected ? { oauthError: "invalid_client" } : {}),
          ...(scopeRejected ? { oauthError: "invalid_grant" } : {}),
          ...(userMessage ? { userMessage } : {}),
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

  function githubHeaders(authorization: string): Record<string, string> {
    return {
      Authorization: authorization,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": userAgent,
    };
  }

  async function scopeUserToken({
    id,
    apiBaseUrl,
    clientId,
    clientSecret,
    accessToken,
    targetId,
    repositoryIds,
    permissions,
  }: ScopeUserTokenOpts): Promise<GitHubUserTokenSet> {
    const url = `${apiBaseUrl.replace(/\/+$/, "")}/applications/${encodeURIComponent(clientId)}/token/scoped`;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        ...githubHeaders(`Basic ${basic}`),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        access_token: accessToken,
        target_id: targetId,
        ...(repositoryIds?.length ? { repository_ids: repositoryIds } : {}),
        ...(permissions && Object.keys(permissions).length
          ? { permissions }
          : {}),
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      const oauthError =
        res.status === 401
          ? "invalid_client"
          : res.status === 404 || res.status === 422
            ? "invalid_grant"
            : undefined;
      throw new OAuthTokenEndpointError(
        `GitHub user token ${id}: scoped-token request failed — ${res.status} ${txt.slice(0, 500)}`,
        { status: res.status, ...(oauthError ? { oauthError } : {}) },
      );
    }
    const data = (await res.json()) as ScopedTokenResponse;
    if (!data.token) {
      throw new Error(
        `GitHub user token ${id}: scoped-token response contained no token`,
      );
    }
    const expiresAt = data.expires_at
      ? Math.floor(Date.parse(data.expires_at) / 1000)
      : undefined;
    const accountLogin = data.installation?.account?.login;
    return {
      accessToken: data.token,
      ...(expiresAt !== undefined && Number.isFinite(expiresAt)
        ? { expiresAt }
        : {}),
      ...(accountLogin ? { accountLogin } : {}),
    };
  }

  async function listUserInstallationRepositories(
    base: string,
    installationId: number,
    headers: Record<string, string>,
  ): Promise<
    Pick<
      GitHubUserTokenInstallation,
      "repositories" | "repositoriesTruncated" | "repositoriesUnavailable"
    >
  > {
    const repositories: { id: number; name: string }[] = [];
    for (let page = 1; page <= MAX_REPO_PAGES; page++) {
      const res = await fetchImpl(
        `${base}/user/installations/${installationId}/repositories?per_page=${REPOS_PER_PAGE}&page=${page}`,
        { headers },
      );
      if (!res.ok) {
        const txt = await res.text();
        return {
          repositories: [],
          repositoriesUnavailable: `${res.status} ${txt.slice(0, 200)}`,
        };
      }
      const body = (await res.json()) as InstallationRepositoriesResponse;
      const batch = body.repositories ?? [];
      for (const repo of batch) {
        if (typeof repo.id === "number" && repo.name) {
          repositories.push({ id: repo.id, name: repo.name });
        }
      }
      if (batch.length < REPOS_PER_PAGE) return { repositories };
    }
    return { repositories, repositoriesTruncated: true };
  }

  async function readUserInstallations({
    id,
    apiBaseUrl,
    accessToken,
  }: ReadUserInstallationsOpts): Promise<GitHubUserTokenProbe> {
    const base = apiBaseUrl.replace(/\/+$/, "");
    const headers = githubHeaders(`Bearer ${accessToken}`);
    const found: Omit<
      GitHubUserTokenInstallation,
      "repositories" | "repositoriesTruncated" | "repositoriesUnavailable"
    >[] = [];
    let installationsTruncated = false;
    for (let page = 1; page <= MAX_INSTALLATION_PAGES; page++) {
      const res = await fetchImpl(
        `${base}/user/installations?per_page=${REPOS_PER_PAGE}&page=${page}`,
        { headers },
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(
          `GitHub user token ${id}: could not list the app installations this sign-in reaches — ${res.status} ${txt.slice(0, 500)}`,
        );
      }
      const body = (await res.json()) as UserInstallationsResponse;
      const batch = body.installations ?? [];
      for (const inst of batch) {
        const targetId = inst.target_id ?? inst.account?.id;
        const accountLogin = inst.account?.login;
        if (typeof inst.id !== "number" || typeof targetId !== "number") {
          continue;
        }
        if (!accountLogin) continue;
        found.push({
          installationId: inst.id,
          targetId,
          accountLogin,
          permissions: inst.permissions ?? {},
          repositorySelection:
            inst.repository_selection === "all" ? "all" : "selected",
        });
      }
      if (batch.length < REPOS_PER_PAGE) break;
      if (page === MAX_INSTALLATION_PAGES) installationsTruncated = true;
    }
    const installations = await Promise.all(
      found.map(async (inst) => ({
        ...inst,
        ...(await listUserInstallationRepositories(
          base,
          inst.installationId,
          headers,
        )),
      })),
    );
    return {
      installations,
      ...(installationsTruncated ? { installationsTruncated: true } : {}),
    };
  }

  return {
    mintInstallationToken,
    scopeUserToken,
    readUserInstallations,

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

      const res = await reachGitHub(apiBaseUrl, () =>
        fetchImpl(
          `${base}/app/installations/${encodeURIComponent(installationId)}`,
          { headers: asApp() },
        ),
      );
      if (!res.ok) {
        const txt = await res.text();
        const userMessage = describeAppRejection(res.status, txt, {
          appId,
          installationId,
          scoped: false,
        });
        throw new OAuthTokenEndpointError(
          `GitHub App ${id}: could not read the installation — ${res.status} ${txt.slice(0, 500)}`,
          { status: res.status, ...(userMessage ? { userMessage } : {}) },
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

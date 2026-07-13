import crypto from "node:crypto";

export interface OAuthProvider {
  id: string;
  /** Absent for token-endpoint-only grants (client credentials). */
  authorizationUrl?: string;
  tokenEndpoint: string;
  clientId: string;
  /** Public clients (PKCE-only) omit this. */
  clientSecret?: string;
  scopes?: string[];
  /**
   * GitHub's token endpoint returns `application/x-www-form-urlencoded`
   */
  tokenEndpointAcceptJson?: boolean;
  /** Provider-specific authorize-URL params (e.g. `allow_signup=false`). */
  extraAuthParams?: Record<string, string>;
}

export interface PendingFlow<Ctx = unknown> {
  provider: OAuthProvider;
  ctx: Ctx;
  codeVerifier: string;
  redirectUri: string;
  state: string;
  createdAt: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Unix seconds. Absent when the provider didn't return `expires_in`. */
  expiresAt?: number;
}

export interface OAuthEngine {
  start<Ctx>(opts: {
    provider: OAuthProvider;
    redirectUri: string;
    ctx: Ctx;
  }): { authUrl: string; state: string };
  peek<Ctx = unknown>(state: string): PendingFlow<Ctx> | null;
  consume<Ctx = unknown>(state: string): PendingFlow<Ctx> | null;
  exchange(pending: PendingFlow, code: string): Promise<TokenSet>;
  refresh(opts: {
    provider: OAuthProvider;
    refreshToken: string;
  }): Promise<TokenSet>;
  clientCredentials(opts: {
    provider: OAuthProvider;
    audience?: string;
  }): Promise<TokenSet>;
}

interface TokenEndpointResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface CreateOAuthEngineOptions {
  now?: () => number;
  fetchImpl?: typeof fetch;
  pendingFlowTtlMs?: number;
}

export function createOAuthEngine(
  opts?: CreateOAuthEngineOptions,
): OAuthEngine {
  const now = opts?.now ?? (() => Date.now());
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const ttlMs = opts?.pendingFlowTtlMs ?? 10 * 60 * 1000;
  const pendingFlows = new Map<string, PendingFlow<unknown>>();

  let janitor: ReturnType<typeof setInterval> | null = null;
  function ensureJanitor() {
    if (janitor != null) return;
    janitor = setInterval(() => {
      const cutoff = now() - ttlMs;
      for (const [k, v] of pendingFlows) {
        if (v.createdAt < cutoff) pendingFlows.delete(k);
      }
    }, 60_000);
    janitor.unref?.();
  }

  async function postTokenEndpoint(
    provider: OAuthProvider,
    body: URLSearchParams,
  ): Promise<TokenSet> {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (provider.tokenEndpointAcceptJson)
      headers["Accept"] = "application/json";
    const res = await fetchImpl(provider.tokenEndpoint, {
      method: "POST",
      headers,
      body,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(
        `OAuth token endpoint ${provider.id}: ${res.status} ${txt.slice(0, 500)}`,
      );
    }
    const ct = res.headers.get("content-type") ?? "";
    let data: Partial<TokenEndpointResponse>;
    if (ct.includes("application/json")) {
      data = (await res.json()) as Partial<TokenEndpointResponse>;
    } else {
      const text = await res.text();
      const parsed = new URLSearchParams(text);
      data = {
        access_token: parsed.get("access_token") ?? undefined,
        refresh_token: parsed.get("refresh_token") ?? undefined,
        expires_in: parsed.get("expires_in")
          ? Number(parsed.get("expires_in"))
          : undefined,
        error: parsed.get("error") ?? undefined,
        error_description: parsed.get("error_description") ?? undefined,
      };
      if (!data.access_token && !data.error) {
        throw new Error(
          `OAuth token endpoint ${provider.id} returned non-JSON without access_token: ${text.slice(0, 200)}`,
        );
      }
    }
    if (!data.access_token) {
      const detail =
        data.error_description ?? data.error ?? "no access_token in response";
      const code = data.error ? `${data.error}: ` : "";
      throw new Error(
        `OAuth ${provider.id} rejected by provider — ${code}${detail}`,
      );
    }
    const tokens: TokenSet = { accessToken: data.access_token };
    if (data.refresh_token) tokens.refreshToken = data.refresh_token;
    if (data.expires_in)
      tokens.expiresAt = Math.floor(now() / 1000) + data.expires_in;
    return tokens;
  }

  return {
    start({ provider, redirectUri, ctx }) {
      if (!provider.authorizationUrl) {
        throw new Error(
          `OAuth provider ${provider.id} has no authorizationUrl`,
        );
      }
      ensureJanitor();
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
      const state = crypto.randomBytes(16).toString("hex");
      pendingFlows.set(state, {
        provider,
        ctx,
        codeVerifier,
        redirectUri,
        state,
        createdAt: now(),
      });

      const authUrl = new URL(provider.authorizationUrl);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", provider.clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      if (provider.scopes?.length) {
        authUrl.searchParams.set("scope", provider.scopes.join(" "));
      }
      for (const [k, v] of Object.entries(provider.extraAuthParams ?? {})) {
        authUrl.searchParams.set(k, v);
      }
      return { authUrl: authUrl.toString(), state };
    },

    peek<Ctx = unknown>(state: string): PendingFlow<Ctx> | null {
      return (pendingFlows.get(state) as PendingFlow<Ctx>) ?? null;
    },

    consume<Ctx = unknown>(state: string): PendingFlow<Ctx> | null {
      const pending = pendingFlows.get(state);
      if (!pending) return null;
      pendingFlows.delete(state);
      return pending as PendingFlow<Ctx>;
    },

    async exchange(pending, code) {
      const params = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: pending.redirectUri,
        client_id: pending.provider.clientId,
        code_verifier: pending.codeVerifier,
      });
      if (pending.provider.clientSecret) {
        params.set("client_secret", pending.provider.clientSecret);
      }
      return postTokenEndpoint(pending.provider, params);
    },

    async refresh({ provider, refreshToken }) {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: provider.clientId,
      });
      if (provider.clientSecret) {
        params.set("client_secret", provider.clientSecret);
      }
      return postTokenEndpoint(provider, params);
    },

    async clientCredentials({ provider, audience }) {
      if (!provider.clientSecret) {
        throw new Error(
          `OAuth provider ${provider.id}: client_credentials requires a client secret`,
        );
      }
      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
      });
      if (provider.scopes?.length) {
        params.set("scope", provider.scopes.join(" "));
      }
      if (audience) params.set("audience", audience);
      return postTokenEndpoint(provider, params);
    },
  };
}

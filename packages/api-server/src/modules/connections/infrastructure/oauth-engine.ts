/**
 * Generic OAuth 2.1 authorization-code engine with PKCE.
 *
 * Reused by both the MCP-server flow (provider config built dynamically from
 * RFC 8414 metadata + RFC 7591 dynamic client registration) and the named-app
 * flow (provider config built statically by the OAuthApp registry — GitHub,
 * GitHub Enterprise, etc.). Token storage is not the engine's job — callers
 * pull the resulting `TokenSet` and write through whichever ports apply.
 *
 * State of in-flight flows lives in a Map keyed by the OAuth `state`
 * parameter. A janitor sweeps entries older than 10 minutes.
 */
import crypto from "node:crypto";

export interface OAuthFlowProvider {
  /**
   * Stable provider id, primarily used in logs/diagnostics. Storage keying
   * lives on `OAuthFlowMetadata.connectionKey` because per-flow providers
   * (MCP, GHE) need a host-derived key, not a static one.
   */
  id: string;
  authorizationUrl: string;
  tokenEndpoint: string;
  clientId: string;
  /** Public clients (PKCE-only) omit this. */
  clientSecret?: string;
  scopes?: string[];
  /**
   * GitHub's token endpoint returns `application/x-www-form-urlencoded`
   * unless asked for JSON. MCP servers and most other providers always
   * return JSON, so this is opt-in.
   */
  tokenEndpointAcceptJson?: boolean;
  /** Provider-specific authorize-URL params (e.g. `allow_signup=false`). */
  extraAuthParams?: Record<string, string>;
}

export interface OAuthFlowMetadata {
  /** Storage key under which the resulting tokens land. */
  connectionKey: string;
  /** Host pattern for downstream credential-injection routing. */
  hostPattern: string;
  /**
   * Human-readable label saved on the resulting K8s Secret. The static apps
   * derive this from the descriptor; the Generic app passes the user's
   * input through so the connections list can show "Linear" instead of
   * "generic-<hash>".
   */
  displayName?: string;
  /**
   * Pod env vars to inject into every agent granted access to this
   * connection's K8s Secret. The placeholder is typically `humr:sentinel`
   * — the Envoy sidecar's credential_injector filter rewrites it to the
   * real token at request time — but for env vars carrying literal config
   * (e.g. `GH_HOST`) it can be a concrete value. Static apps populate this
   * from the descriptor; Generic leaves it unset (no provider-specific
   * tooling convention to enforce).
   */
  envMappings?: import("api-server-api").EnvMapping[];
}

export interface PendingFlow {
  provider: OAuthFlowProvider;
  flow: OAuthFlowMetadata;
  codeVerifier: string;
  redirectUri: string;
  state: string;
  userJwt: string;
  userSub: string;
  createdAt: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Unix seconds. Absent when the provider didn't return `expires_in`. */
  expiresAt?: number;
}

export interface OAuthEngine {
  start(opts: {
    provider: OAuthFlowProvider;
    flow: OAuthFlowMetadata;
    redirectUri: string;
    userJwt: string;
    userSub: string;
  }): { authUrl: string; state: string };
  consume(state: string): PendingFlow | null;
  exchange(pending: PendingFlow, code: string): Promise<TokenSet>;
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

interface TokenEndpointResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

export interface CreateOAuthEngineOptions {
  /** Override for tests. */
  now?: () => number;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  /** Pending-flow TTL. Default 10 minutes. */
  pendingFlowTtlMs?: number;
}

export function createOAuthEngine(opts?: CreateOAuthEngineOptions): OAuthEngine {
  const now = opts?.now ?? (() => Date.now());
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const ttlMs = opts?.pendingFlowTtlMs ?? 10 * 60 * 1000;
  const pendingFlows = new Map<string, PendingFlow>();

  // Lazy janitor — kicks off on first use rather than at module load so
  // tests don't leak intervals.
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

  return {
    start({ provider, flow, redirectUri, userJwt, userSub }) {
      ensureJanitor();
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);
      const state = crypto.randomBytes(16).toString("hex");
      const pending: PendingFlow = {
        provider,
        flow,
        codeVerifier,
        redirectUri,
        state,
        userJwt,
        userSub,
        createdAt: now(),
      };
      pendingFlows.set(state, pending);

      const authUrl = new URL(provider.authorizationUrl);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", provider.clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      if (provider.scopes && provider.scopes.length > 0) {
        authUrl.searchParams.set("scope", provider.scopes.join(" "));
      }
      for (const [k, v] of Object.entries(provider.extraAuthParams ?? {})) {
        authUrl.searchParams.set(k, v);
      }
      return { authUrl: authUrl.toString(), state };
    },

    consume(state) {
      const pending = pendingFlows.get(state);
      if (!pending) return null;
      pendingFlows.delete(state);
      return pending;
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
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      if (pending.provider.tokenEndpointAcceptJson) {
        headers["Accept"] = "application/json";
      }
      const res = await fetchImpl(pending.provider.tokenEndpoint, {
        method: "POST",
        headers,
        body: params,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `OAuth token exchange failed: ${res.status} ${body.slice(0, 500)}`,
        );
      }
      const contentType = res.headers.get("content-type") ?? "";
      let data: Partial<TokenEndpointResponse> & { error?: string; error_description?: string };
      if (contentType.includes("application/json")) {
        data = (await res.json()) as typeof data;
      } else {
        // GitHub falls back to form-encoded if `Accept: application/json` was
        // not set; tolerate that defensively.
        const text = await res.text();
        const parsed = new URLSearchParams(text);
        const access_token = parsed.get("access_token");
        const error = parsed.get("error");
        data = {
          ...(access_token ? { access_token } : {}),
          ...(parsed.get("refresh_token") ? { refresh_token: parsed.get("refresh_token")! } : {}),
          ...(parsed.get("token_type") ? { token_type: parsed.get("token_type")! } : {}),
          ...(parsed.get("expires_in") ? { expires_in: Number(parsed.get("expires_in")) } : {}),
          ...(parsed.get("scope") ? { scope: parsed.get("scope")! } : {}),
          ...(error ? { error } : {}),
          ...(parsed.get("error_description") ? { error_description: parsed.get("error_description")! } : {}),
        };
        if (!access_token && !error) {
          throw new Error(
            `OAuth token endpoint returned non-JSON without access_token: ${text.slice(0, 200)}`,
          );
        }
      }

      // GitHub (and some other providers) return HTTP 200 even on errors,
      // with `{error, error_description, ...}` in the body. Catch it here
      // before the missing access_token bubbles into a confusing
      // downstream "expected string, received undefined" when the Secret
      // is written.
      if (!data.access_token) {
        const detail = data.error_description ?? data.error ?? "no access_token in response";
        const code = data.error ? `${data.error}: ` : "";
        throw new Error(`OAuth token exchange rejected by provider — ${code}${detail}`);
      }

      const tokens: TokenSet = { accessToken: data.access_token };
      if (data.refresh_token) tokens.refreshToken = data.refresh_token;
      if (data.expires_in) tokens.expiresAt = Math.floor(now() / 1000) + data.expires_in;
      return tokens;
    },
  };
}

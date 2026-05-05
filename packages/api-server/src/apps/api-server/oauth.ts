/**
 * OAuth 2.1 routes for the API Server: MCP servers (RFC 8414 discovery + RFC
 * 7591 dynamic client registration) and named "apps" (GitHub, GitHub
 * Enterprise) registered statically by the OAuthApp registry.
 *
 * Tokens are stored as per-`(owner, connection)` K8s Secrets consumed by the
 * Envoy sidecar and the refresh-token loop (ADR-033).
 */

import { Hono } from "hono";
import type { UserIdentity } from "api-server-api";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  createK8sConnectionsPort,
  type ConnectionMetadata,
  type K8sConnectionsPort,
} from "../../modules/connections/infrastructure/k8s-connections-port.js";
import {
  createOAuthEngine,
  type OAuthEngine,
} from "../../modules/connections/infrastructure/oauth-engine.js";
import {
  matchesAppConnection,
  type OAuthAppDescriptor,
  type OAuthAppRegistry,
} from "../../modules/connections/infrastructure/oauth-apps.js";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface OAuthRoutesDeps {
  uiBaseUrl: string;
  k8sClient: K8sClient;
  apps: OAuthAppRegistry;
  /** Override for tests — defaults to a fresh process-local engine. */
  engine?: OAuthEngine;
  /** Display name surfaced as `client_name` during RFC 7591 dynamic client
   *  registration (visible in the OAuth provider's app list). Sourced from
   *  brand config so a deployment rebrand renames the registration without
   *  a code change. */
  brandName: string;
}

export function createOAuthRoutes(deps: OAuthRoutesDeps) {
  const { uiBaseUrl, k8sClient, apps, brandName } = deps;
  const engine = deps.engine ?? createOAuthEngine();
  const oauth = new Hono<{ Variables: { user: UserIdentity } }>();

  function getUserJwt(c: { req: { header: (name: string) => string | undefined } }): string {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("missing authorization header");
    return authHeader.slice(7);
  }

  function k8sConnectionsFor(userSub: string): K8sConnectionsPort {
    return createK8sConnectionsPort(k8sClient, userSub);
  }

  // -------------------------------------------------------------------------
  // Named OAuth apps (GitHub, GitHub Enterprise)
  // -------------------------------------------------------------------------

  oauth.get("/api/oauth/apps", (c) => {
    // Bake the callback URL into each descriptor so the connect form can
    // surface it — every OAuth app the user registers at the provider must
    // be configured with this exact URL as its redirect URI.
    const callbackUrl = `${uiBaseUrl}/api/oauth/callback`;
    return c.json(apps.list().map((d) => ({ ...d, callbackUrl })));
  });

  /**
   * Issuer discovery for the Generic app's connect form. The browser can't
   * fetch arbitrary cross-origin discovery documents, so we proxy from the
   * api-server. Tries RFC 8414 (OAuth 2.0 AS metadata) first and falls back
   * to RFC 8414 / OIDC at `/.well-known/openid-configuration`.
   */
  oauth.post("/api/oauth/discover", async (c) => {
    let body: { host?: string };
    try {
      body = await c.req.json<{ host?: string }>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const host = body.host?.trim();
    if (!host) return c.json({ error: "host is required" }, 400);
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(host)) {
      return c.json({ error: "host must be a valid DNS hostname" }, 400);
    }
    const candidates = [
      `https://${host}/.well-known/oauth-authorization-server`,
      `https://${host}/.well-known/openid-configuration`,
    ];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          authorization_endpoint?: string;
          token_endpoint?: string;
          scopes_supported?: string[];
        };
        if (
          typeof data.authorization_endpoint === "string" &&
          typeof data.token_endpoint === "string"
        ) {
          return c.json({
            authorizationUrl: data.authorization_endpoint,
            tokenEndpoint: data.token_endpoint,
            ...(Array.isArray(data.scopes_supported)
              ? { scopesSupported: data.scopes_supported }
              : {}),
            source: url,
          });
        }
      } catch {
        // try next candidate
      }
    }
    return c.json({ error: "Discovery not supported by host" }, 404);
  });

  oauth.get("/api/oauth/apps/connections", async (c) => {
    try {
      const user = c.get("user");
      const k8sConns = await k8sConnectionsFor(user.sub).listConnections();
      const nowSec = Math.floor(Date.now() / 1000);
      const appConns = k8sConns
        .map((conn) => {
          const app = apps.list().find((a) => matchesAppConnection(a, conn.connection));
          if (!app) return null;
          const expired =
            conn.status === "expired" ||
            (conn.expiresAt != null && conn.expiresAt < nowSec);
          const displayName =
            conn.displayName ??
            (app.id === "github-enterprise"
              ? `${app.displayName} (${conn.hostPattern})`
              : app.displayName);
          const connectionId =
            app.cardinality === "single" ? app.id : conn.connection;
          return {
            appId: app.id,
            connectionId,
            displayName,
            hostPattern: conn.hostPattern,
            connectedAt: conn.connectedAt ?? "",
            expired,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return c.json(appConns);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: msg }, 500);
    }
  });

  oauth.post("/api/oauth/apps/:id/connect", async (c) => {
    const id = c.req.param("id");
    const descriptor = apps.get(id);
    if (!descriptor) return c.json({ error: "Unknown app" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    let built;
    try {
      built = apps.build(descriptor.id, body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid input";
      return c.json({ error: msg }, 400);
    }
    const user = c.get("user");
    const jwt = getUserJwt(c);
    const redirectUri = `${uiBaseUrl}/api/oauth/callback`;
    const { authUrl } = engine.start({
      provider: built.provider,
      flow: built.flow,
      redirectUri,
      userJwt: jwt,
      userSub: user.sub,
    });
    return c.json({ authUrl });
  });

  oauth.delete("/api/oauth/apps/connections/:id", async (c) => {
    const id = c.req.param("id");
    const descriptor = apps.get(id);
    let connectionKey: string;
    if (descriptor) {
      if (descriptor.cardinality !== "single") {
        return c.json(
          { error: "Multi-instance app requires a connection key, not the app id." },
          400,
        );
      }
      connectionKey = descriptor.connectionKey;
    } else {
      const matchingApp = apps.list().find((a) => matchesAppConnection(a, id));
      if (!matchingApp) return c.json({ error: "Unknown connection" }, 404);
      connectionKey = id;
    }
    const user = c.get("user");
    await k8sConnectionsFor(user.sub).deleteConnection(connectionKey);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // MCP servers
  // -------------------------------------------------------------------------

  oauth.get("/api/mcp/connections", async (c) => {
    try {
      const user = c.get("user");
      const k8sConns = await k8sConnectionsFor(user.sub).listConnections();
      const appList = apps.list();
      const nowSec = Math.floor(Date.now() / 1000);
      const merged = k8sConns
        .filter((conn) => !appList.some((a) => matchesAppConnection(a, conn.connection)))
        .map((conn) => ({
          hostname: conn.connection,
          connectedAt: conn.connectedAt ?? "",
          expired:
            conn.status === "expired" || (conn.expiresAt != null && conn.expiresAt < nowSec),
        }));
      return c.json(merged);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: msg }, 500);
    }
  });

  oauth.delete("/api/mcp/connections/:hostname", async (c) => {
    const hostname = c.req.param("hostname");
    try {
      const user = c.get("user");
      await k8sConnectionsFor(user.sub).deleteConnection(hostname);
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * Kicks off an MCP OAuth flow: discovers the AS metadata at the MCP
   * server's origin, registers a public client via DCR, then hands off to
   * the engine for the PKCE auth-code dance.
   */
  oauth.post("/api/oauth/start", async (c) => {
    const user = c.get("user");
    const jwt = getUserJwt(c);
    const body = await c.req.json<{ mcpServerUrl: string }>();
    const mcpUrl = new URL(body.mcpServerUrl);
    const origin = mcpUrl.origin;
    const hostPattern = mcpUrl.hostname;

    const metaRes = await fetch(`${origin}/.well-known/oauth-authorization-server`);
    if (!metaRes.ok) {
      return c.json({ error: "MCP server does not support OAuth discovery" }, 400);
    }
    const meta = (await metaRes.json()) as {
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint?: string;
    };

    if (!meta.registration_endpoint) {
      return c.json(
        { error: "MCP server does not support dynamic client registration" },
        400,
      );
    }

    const redirectUri = `${uiBaseUrl}/api/oauth/callback`;
    const regRes = await fetch(meta.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: `${brandName} Agent Platform`,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    if (!regRes.ok) {
      const errBody = await regRes.text();
      return c.json(
        { error: `Client registration failed: ${regRes.status} ${errBody}` },
        400,
      );
    }
    const regData = (await regRes.json()) as { client_id: string; client_secret?: string };

    const { authUrl, state } = engine.start({
      provider: {
        id: `mcp:${hostPattern}`,
        authorizationUrl: meta.authorization_endpoint,
        tokenEndpoint: meta.token_endpoint,
        clientId: regData.client_id,
        ...(regData.client_secret ? { clientSecret: regData.client_secret } : {}),
      },
      flow: { connectionKey: hostPattern, hostPattern },
      redirectUri,
      userJwt: jwt,
      userSub: user.sub,
    });
    return c.json({ authUrl, state });
  });

  // -------------------------------------------------------------------------
  // Unified callback for every flow the engine started
  // -------------------------------------------------------------------------

  oauth.get("/api/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.redirect(
        `${uiBaseUrl}?oauth=error&message=${encodeURIComponent(error)}`,
      );
    }
    if (!code || !state) {
      return c.redirect(`${uiBaseUrl}?oauth=error&message=missing+parameters`);
    }
    const pending = engine.consume(state);
    if (!pending) {
      return c.redirect(`${uiBaseUrl}?oauth=error&message=invalid+state`);
    }

    let tokens;
    try {
      tokens = await engine.exchange(pending, code);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.redirect(
        `${uiBaseUrl}?oauth=error&message=${encodeURIComponent(msg)}`,
      );
    }

    const isMcp = pending.provider.id.startsWith("mcp:");

    const metadata: ConnectionMetadata = {
      hostPattern: pending.flow.hostPattern,
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
      tokenUrl: pending.provider.tokenEndpoint,
      authorizationUrl: pending.provider.authorizationUrl,
      clientId: pending.provider.clientId,
      ...(pending.provider.clientSecret ? { clientSecret: pending.provider.clientSecret } : {}),
      grantType: "authorization_code",
      ...(pending.flow.displayName ? { displayName: pending.flow.displayName } : {}),
      ...(pending.provider.scopes && pending.provider.scopes.length > 0
        ? { scopes: pending.provider.scopes.join(" ") }
        : {}),
    };
    try {
      await k8sConnectionsFor(pending.userSub).upsertConnection({
        connection: pending.flow.connectionKey,
        tokens: {
          accessToken: tokens.accessToken,
          ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
          ...(tokens.expiresAt != null ? { expiresAt: tokens.expiresAt } : {}),
        },
        metadata,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.redirect(`${uiBaseUrl}?oauth=error&message=${encodeURIComponent(msg)}`);
    }

    const successQuery = isMcp
      ? `oauth=success&host=${pending.flow.hostPattern}`
      : `oauth=success&app=${encodeURIComponent(pending.flow.connectionKey)}`;
    return c.redirect(`${uiBaseUrl}?${successQuery}`);
  });

  return oauth;
}

export type { OAuthAppDescriptor };

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
  callbackUrlForApp,
  matchesAppConnection,
  type OAuthAppDescriptor,
  type OAuthAppRegistry,
} from "../../modules/connections/infrastructure/oauth-apps.js";
import { discoverMcpAuth } from "../../modules/connections/infrastructure/mcp-discovery.js";

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

  function getUserJwt(c: {
    req: { header: (name: string) => string | undefined };
  }): string {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer "))
      throw new Error("missing authorization header");
    return authHeader.slice(7);
  }

  function k8sConnectionsFor(userSub: string): K8sConnectionsPort {
    return createK8sConnectionsPort(k8sClient, userSub);
  }

  /**
   * For each `credentialFamily` the user has at least one connection in,
   * pick the first connection's `clientId` / `clientSecret` from its stored
   * metadata. Sibling descriptors in the same family use these to skip
   * re-asking the user — register one OAuth app at the provider, connect
   * many services with it.
   */
  async function readFamilyCreds(
    port: K8sConnectionsPort,
  ): Promise<Map<string, { clientId: string; clientSecret: string }>> {
    const out = new Map<string, { clientId: string; clientSecret: string }>();
    const summaries = await port.listConnections();
    const descriptors = apps.list();
    for (const summary of summaries) {
      const matched = descriptors.find((d) =>
        matchesAppConnection(d, summary.connection),
      );
      const family = matched?.credentialFamily;
      if (!family || out.has(family)) continue;
      const record = await port.getConnection(summary.connection);
      const cid = record?.metadata.clientId;
      const csec = record?.metadata.clientSecret;
      if (cid && csec) out.set(family, { clientId: cid, clientSecret: csec });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Named OAuth apps (GitHub, GitHub Enterprise)
  // -------------------------------------------------------------------------

  oauth.get("/api/oauth/apps", async (c) => {
    // Bake the callback URL into each descriptor so the connect form can
    // surface it — every OAuth app the user registers at the provider must
    // be configured with this exact URL as its redirect URI. Per-descriptor
    // because some providers (e.g. Spotify) reject `localhost` and need a
    // host-rewritten callback (see `localhostCallbackAlias`).
    //
    // Descriptors with `credentialFamily` set get their credential inputs
    // marked `overridable: true` when the user already has a sibling
    // connection in the same family. The connect form hides those inputs
    // behind an "override" toggle; on submit, empty fields fall through
    // to the stored family creds (see the merge step in POST
    // /api/oauth/apps/:id/connect), and filled fields override them.
    const user = c.get("user");
    const familyCreds = await readFamilyCreds(k8sConnectionsFor(user.sub));
    return c.json(
      apps.list().map((d) => {
        const inheritFamily =
          d.credentialFamily && familyCreds.has(d.credentialFamily);
        const inputs = inheritFamily
          ? d.inputs.map((i) =>
              i.name === "clientId" || i.name === "clientSecret"
                ? { ...i, overridable: true }
                : i,
            )
          : d.inputs;
        return {
          ...d,
          inputs,
          ...(inheritFamily ? { credentialsInherited: true as const } : {}),
          callbackUrl: callbackUrlForApp(d, uiBaseUrl),
        };
      }),
    );
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
    if (
      !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(
        host,
      )
    ) {
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
          const app = apps
            .list()
            .find((a) => matchesAppConnection(a, conn.connection));
          if (!app) return null;
          const expired =
            conn.status === "expired" ||
            (conn.expiresAt != null && conn.expiresAt < nowSec);
          const displayName =
            conn.displayName ??
            (app.id === "github-enterprise"
              ? `${app.displayName} (${conn.hosts[0] ?? ""})`
              : app.displayName);
          const connectionId =
            app.cardinality === "single" ? app.id : conn.connection;
          return {
            appId: app.id,
            connectionId,
            displayName,
            hosts: conn.hosts,
            connectedAt: conn.connectedAt ?? "",
            expired,
            // Surfaces the GitHub App slug when the connection's credentials
            // belong to a GitHub App — drives the "Install on GitHub" /
            // "Manage installation" affordance in the UI.
            ...(conn.appSlug ? { appSlug: conn.appSlug } : {}),
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
    const user = c.get("user");
    // Inherit clientId / clientSecret from a sibling connection in the same
    // credentialFamily when the body omits them. Mirrors the input pruning
    // applied by GET /api/oauth/apps so the connect form doesn't have to
    // round-trip the credentials it never showed the user.
    if (descriptor.credentialFamily) {
      const merged =
        body && typeof body === "object"
          ? { ...(body as Record<string, unknown>) }
          : {};
      if (!merged.clientId || !merged.clientSecret) {
        const familyCreds = await readFamilyCreds(k8sConnectionsFor(user.sub));
        const creds = familyCreds.get(descriptor.credentialFamily);
        if (creds) {
          if (!merged.clientId) merged.clientId = creds.clientId;
          if (!merged.clientSecret) merged.clientSecret = creds.clientSecret;
          body = merged;
        }
      }
    }
    let built;
    try {
      built = apps.build(descriptor.id, body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid input";
      return c.json({ error: msg }, 400);
    }
    const jwt = getUserJwt(c);
    const redirectUri = callbackUrlForApp(descriptor, uiBaseUrl);
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
          {
            error:
              "Multi-instance app requires a connection key, not the app id.",
          },
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
        .filter(
          (conn) =>
            !appList.some((a) => matchesAppConnection(a, conn.connection)),
        )
        .map((conn) => ({
          hostname: conn.connection,
          connectedAt: conn.connectedAt ?? "",
          expired:
            conn.status === "expired" ||
            (conn.expiresAt != null && conn.expiresAt < nowSec),
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
   * Kicks off an MCP OAuth flow. Discovery follows the MCP 2025-06-18
   * authorization spec: fetch the resource's RFC 9728 protected-resource
   * metadata to learn the authorization server, then RFC 8414 AS metadata
   * to learn the endpoints. Falls back to treating the MCP origin as the
   * AS for older servers. Then DCR (RFC 7591) and hand off to the engine
   * for the PKCE auth-code dance.
   */
  oauth.post("/api/oauth/start", async (c) => {
    const user = c.get("user");
    const jwt = getUserJwt(c);
    const body = await c.req.json<{ mcpServerUrl: string }>();
    const mcpUrl = new URL(body.mcpServerUrl);
    const hostPattern = mcpUrl.hostname;

    const meta = await discoverMcpAuth(mcpUrl);
    if (!meta) {
      return c.json(
        { error: "MCP server does not support OAuth discovery" },
        400,
      );
    }
    if (!meta.registrationEndpoint) {
      return c.json(
        { error: "MCP server does not support dynamic client registration" },
        400,
      );
    }

    const redirectUri = `${uiBaseUrl}/api/oauth/callback`;
    const regRes = await fetch(meta.registrationEndpoint, {
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
    const regData = (await regRes.json()) as {
      client_id: string;
      client_secret?: string;
    };

    const { authUrl, state } = engine.start({
      provider: {
        id: `mcp:${hostPattern}`,
        authorizationUrl: meta.authorizationEndpoint,
        tokenEndpoint: meta.tokenEndpoint,
        clientId: regData.client_id,
        ...(regData.client_secret
          ? { clientSecret: regData.client_secret }
          : {}),
        ...(meta.scopes && meta.scopes.length > 0
          ? { scopes: meta.scopes }
          : {}),
      },
      flow: { connectionKey: hostPattern, hosts: [{ host: hostPattern }] },
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
      // Authoritative for both injection and egress. GitHub declares
      // three (issue #219); other apps one each.
      hosts: pending.flow.hosts,
      tokenUrl: pending.provider.tokenEndpoint,
      authorizationUrl: pending.provider.authorizationUrl,
      clientId: pending.provider.clientId,
      ...(pending.provider.clientSecret
        ? { clientSecret: pending.provider.clientSecret }
        : {}),
      grantType: "authorization_code",
      ...(pending.flow.displayName
        ? { displayName: pending.flow.displayName }
        : {}),
      ...(pending.provider.scopes && pending.provider.scopes.length > 0
        ? { scopes: pending.provider.scopes.join(" ") }
        : {}),
      ...(pending.flow.appSlug ? { appSlug: pending.flow.appSlug } : {}),
      // Declarative env-var declarations (`GH_TOKEN`, `GH_HOST`, …)
      // sourced from the descriptor's `flow.envMappings`. The controller
      // materialises these as agent pod env vars; without this the
      // controller falls back to host-specific hardcodes.
      ...(pending.flow.envMappings?.length
        ? { envMappings: pending.flow.envMappings }
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
      return c.redirect(
        `${uiBaseUrl}?oauth=error&message=${encodeURIComponent(msg)}`,
      );
    }

    // Always return the user to the platform UI after OAuth, even for
    // GitHub App connections that still need an install step. The UI then
    // reads the just-stored connection (which carries `appSlug` for
    // GitHub Apps) and surfaces an in-platform Install prompt — keeps the
    // user in our context, avoids stranding them on GitHub's install page
    // when the app is already installed, and removes the open-redirect
    // surface the previous server-side install bounce required.
    const successParams = new URLSearchParams();
    successParams.set("oauth", "success");
    if (isMcp) successParams.set("host", pending.flow.hosts[0]!.host);
    else successParams.set("app", pending.flow.connectionKey);
    return c.redirect(`${uiBaseUrl}?${successParams.toString()}`);
  });

  return oauth;
}

export type { OAuthAppDescriptor };

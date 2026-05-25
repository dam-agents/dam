import { Hono } from "hono";
import type { Db } from "db";
import type { OAuthEngine } from "../../modules/connections/infrastructure/oauth-engine.js";
import type { ConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import {
  createOAuthFlowService,
  type OAuthFlowPendingCtx,
} from "../../modules/connections/services/oauth-flow.js";
import { createConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";

/**
 * Unified OAuth callback (ADR-051). Every flow the engine started lands
 * here regardless of provider — the `state` parameter resolves back to a
 * pending PendingFlow that carries the Connection id + owner sub.
 *
 * The callback is unauthenticated (the provider's redirect carries no
 * session cookie). Security comes from:
 *   - the `state` parameter being unguessable + single-use,
 *   - the PendingFlow's `ctx.ownerId` being the only thing the handler
 *     uses to identify the user (no header / cookie read).
 *
 * Tokens land in SecretStore via OAuthFlowService.completeOAuth, which
 * also stamps `auth.expiresAt` on the Connection row.
 */
export interface OAuthCallbackDeps {
  db: Db;
  secretStore: SecretStore;
  engine: OAuthEngine;
  templates: ConnectionTemplateRegistry;
  uiBaseUrl: string;
}

export function createOAuthRoutes(deps: OAuthCallbackDeps) {
  const oauth = new Hono();

  oauth.get("/api/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const providerError = c.req.query("error");

    if (providerError) {
      return c.redirect(
        `${deps.uiBaseUrl}?oauth=error&message=${encodeURIComponent(providerError)}`,
      );
    }
    if (!code || !state) {
      return c.redirect(
        `${deps.uiBaseUrl}?oauth=error&message=missing+parameters`,
      );
    }

    // Peek (non-consuming) to discover which owner started this flow. The
    // OAuthFlowService.completeOAuth path then does the real consume.
    const peeked = deps.engine.peek<OAuthFlowPendingCtx>(state);
    if (!peeked) {
      return c.redirect(`${deps.uiBaseUrl}?oauth=error&message=invalid+state`);
    }

    const flow = createOAuthFlowService({
      engine: deps.engine,
      repo: createConnectionsRepository(deps.db),
      templates: deps.templates,
      secretStore: deps.secretStore,
      ownerId: peeked.ctx.ownerId,
      // Unused on completeOAuth path (start path only). Stub.
      callbackUrl: "",
    });

    try {
      const result = await flow.completeOAuth(state, code);
      const params = new URLSearchParams();
      params.set("oauth", "success");
      params.set("connection", result.connectionId);
      return c.redirect(`${deps.uiBaseUrl}?${params.toString()}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.redirect(
        `${deps.uiBaseUrl}?oauth=error&message=${encodeURIComponent(msg)}`,
      );
    }
  });

  return oauth;
}

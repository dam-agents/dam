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

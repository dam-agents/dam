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
import { sanitizeReturnTo } from "../../modules/connections/domain/oauth-callback-url.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

export interface OAuthCallbackDeps {
  db: Db;
  secretStore: SecretStore;
  engine: OAuthEngine;
  templates: ConnectionTemplateRegistry;
  runtimeMutator: RuntimeMutator;
  uiBaseUrl: string;
}

export function createOAuthRoutes(deps: OAuthCallbackDeps) {
  const oauth = new Hono();

  const targetOrigin = new URL(deps.uiBaseUrl).origin;

  oauth.get("/api/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const providerError = c.req.query("error");

    const peeked = state
      ? deps.engine.peek<OAuthFlowPendingCtx>(state)
      : undefined;
    const returnTo = sanitizeReturnTo(peeked?.ctx.returnTo);
    const popup = Boolean(peeked?.ctx.popup);

    const respondSuccess = (connectionId: string) => {
      if (popup)
        return c.html(
          renderPopupResult(targetOrigin, {
            oauth: "success",
            connection: connectionId,
          }),
        );
      const params = new URLSearchParams();
      params.set("oauth", "success");
      params.set("connection", connectionId);
      return c.redirect(`${deps.uiBaseUrl}${returnTo}?${params.toString()}`);
    };

    const respondError = (message: string) => {
      if (popup)
        return c.html(
          renderPopupResult(targetOrigin, { oauth: "error", message }),
        );
      const params = new URLSearchParams();
      params.set("oauth", "error");
      params.set("message", message);
      return c.redirect(`${deps.uiBaseUrl}${returnTo}?${params.toString()}`);
    };

    if (providerError) return respondError(providerError);
    if (!code || !state) return respondError("missing parameters");
    if (!peeked) return respondError("invalid state");

    const flow = createOAuthFlowService({
      engine: deps.engine,
      repo: createConnectionsRepository(deps.db),
      templates: deps.templates,
      secretStore: deps.secretStore,
      runtimeMutator: deps.runtimeMutator,
      ownerId: peeked.ctx.ownerId,
      callbackUrl: "",
    });

    try {
      const result = await flow.completeOAuth(state, code);
      return respondSuccess(result.connectionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return respondError(msg);
    }
  });

  return oauth;
}

interface PopupResult {
  oauth: "success" | "error";
  connection?: string;
  message?: string;
}

/**
 * Self-contained page for the popup OAuth flow: posts the result to the
 * opener and closes. `<` is escaped in the embedded JSON so a provider error
 * message can't break out of the <script> element.
 */
function renderPopupResult(targetOrigin: string, result: PopupResult): string {
  const payload = JSON.stringify({
    source: "platform-oauth",
    ...result,
  }).replace(/</g, "\\u003c");
  const origin = JSON.stringify(targetOrigin).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Authorizing…</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 2rem; color: #444;">
    <p>You can close this window.</p>
    <script>
      (function () {
        try {
          if (window.opener) window.opener.postMessage(${payload}, ${origin});
        } catch (e) {}
        window.close();
      })();
    </script>
  </body>
</html>`;
}

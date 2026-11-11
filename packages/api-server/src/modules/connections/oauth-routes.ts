import { Hono } from "hono";
import type { Db } from "db";
import type { OAuthEngine } from "./infrastructure/oauth-engine.js";
import type { GitHubAppEngine } from "./infrastructure/github-app-engine.js";
import type { ConnectionTemplateRegistry } from "./domain/connection-template.js";
import type { SecretStore } from "../secret-store/index.js";
import {
  createOAuthFlowService,
  type OAuthFlowPendingCtx,
} from "./services/oauth-flow.js";
import { createConnectionsRepository } from "./infrastructure/connections-repository.js";
import { createXactLock } from "../../core/xact-lock.js";
import {
  oauthCallbackUrl,
  sanitizeReturnTo,
} from "./domain/oauth-callback-url.js";
import {
  CLIENT_ID_METADATA_FILE,
  clientIdMetadataDocument,
} from "./domain/client-id-metadata.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export interface OAuthCallbackDeps {
  db: Db;
  secretStore: SecretStore;
  engine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  templates: ConnectionTemplateRegistry;
  runtimeMutator: RuntimeMutator;
  uiBaseUrl: string;
  brandName: string;
}

export function createOAuthRoutes(deps: OAuthCallbackDeps) {
  const oauth = new Hono();

  const targetOrigin = new URL(deps.uiBaseUrl).origin;
  const clientMetadata = clientIdMetadataDocument({
    callbackUrl: oauthCallbackUrl(deps.uiBaseUrl),
    brandName: deps.brandName,
  });

  oauth.get(`/${CLIENT_ID_METADATA_FILE}`, (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(clientMetadata);
  });

  oauth.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const providerError = c.req.query("error");

    const peeked = state
      ? await deps.engine.peek<OAuthFlowPendingCtx>(state)
      : undefined;
    const returnTo = sanitizeReturnTo(peeked?.ctx.returnTo);
    const popup = Boolean(peeked?.ctx.popup);

    const respondSuccess = (connectionId: string) => {
      if (popup)
        return c.html(
          renderPopupResult(targetOrigin, deps.brandName, {
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
          renderPopupResult(targetOrigin, deps.brandName, {
            oauth: "error",
            message,
            ...(peeked ? { connection: peeked.ctx.connectionId } : {}),
          }),
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
      githubAppEngine: deps.githubAppEngine,
      repo: createConnectionsRepository(deps.db),
      templates: deps.templates,
      secretStore: deps.secretStore,
      runtimeMutator: deps.runtimeMutator,
      ownerId: peeked.ctx.ownerId,
      callbackUrl: "",
      connectionLock: createXactLock(deps.db),
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPopupResult(
  targetOrigin: string,
  brandName: string,
  result: PopupResult,
): string {
  const notice =
    result.oauth === "success"
      ? `Signed in. ${brandName} is finishing the sign-in. You can close this window.`
      : `The sign-in did not finish. You can close this window and try again in ${brandName}.`;
  const payload = JSON.stringify({
    source: "platform-oauth",
    ...result,
  }).replace(/</g, "\\u003c");
  const origin = JSON.stringify(targetOrigin).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Authorizing…</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 2rem; color: #444;">
    <p>${escapeHtml(notice)}</p>
    <script>
      (function () {
        var result = ${payload};
        try {
          if (window.opener) window.opener.postMessage(result, ${origin});
        } catch (e) {}
        try {
          var channel = new BroadcastChannel("platform-oauth");
          channel.postMessage(result);
          channel.close();
        } catch (e) {}
        window.close();
      })();
    </script>
  </body>
</html>`;
}

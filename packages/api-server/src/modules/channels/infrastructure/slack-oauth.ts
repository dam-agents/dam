import { Hono } from "hono";
import type { SlackOAuthPending } from "./slack.js";
import type { IdentityLinkService } from "./../services/identity-link-service.js";
import {
  exchangeCodeForTokens,
  type KeycloakOAuthConfig,
} from "./identity-oauth.js";

const FLOW_TTL_MS = 10 * 60 * 1000;

export function createSlackOAuthRoutes(deps: {
  pendingFlows: Map<string, SlackOAuthPending>;
  identityLinks: IdentityLinkService;
  oauthConfig: KeycloakOAuthConfig;
  /** Lowercase brand identifier — used to render the slash command name in
   *  user-facing error messages ("Run `/<brandShort> login` again"). */
  brandShort: string;
}) {
  const routes = new Hono();

  routes.get("/api/slack/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.text(`Login failed: ${error}`, 400);
    }

    if (!code || !state) {
      return c.text("Missing parameters", 400);
    }

    const pending = deps.pendingFlows.get(state);
    if (!pending) {
      return c.text("Invalid or expired state", 400);
    }

    if (Date.now() - pending.createdAt > FLOW_TTL_MS) {
      deps.pendingFlows.delete(state);
      return c.text(
        `Login link expired. Run \`/${deps.brandShort} login\` again.`,
        400,
      );
    }

    deps.pendingFlows.delete(state);

    const result = await exchangeCodeForTokens(
      deps.oauthConfig,
      code,
      pending.codeVerifier,
    );
    if ("error" in result) {
      process.stderr.write(`[slack-oauth] ${result.error}\n`);
      return c.text(
        `Token exchange failed. Run \`/${deps.brandShort} login\` again.`,
        400,
      );
    }

    await deps.identityLinks.link(
      "slack",
      pending.slackUserId,
      result.keycloakSub,
      result.refreshToken,
    );

    return c.html(
      "<html><body><h2>Account linked!</h2><p>You can close this window and return to Slack.</p></body></html>",
    );
  });

  return routes;
}

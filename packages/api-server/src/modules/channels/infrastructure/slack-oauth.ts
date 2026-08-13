import { Hono } from "hono";
import type { SlackOAuthPending } from "./slack.js";
import type { TtlStore } from "../../../core/ttl-store.js";
import type { SlackBindFlowStore } from "./slack-flows.js";
import type { IdentityLinkService } from "./../services/identity-link-service.js";
import {
  exchangeCodeForTokens,
  type KeycloakOAuthConfig,
} from "./identity-oauth.js";
import { securityLog } from "../../../core/security-log.js";

const FLOW_TTL_MS = 10 * 60 * 1000;

export function createSlackOAuthRoutes(deps: {
  pendingFlows: TtlStore<SlackOAuthPending>;
  bindFlows: SlackBindFlowStore;
  identityLinks: IdentityLinkService;
  oauthConfig: KeycloakOAuthConfig;
  uiBaseUrl: string;
  brandShort: string;
}) {
  const routes = new Hono();
  const bindPage = `${deps.uiBaseUrl}/slack/bind`;

  routes.get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.text(`Login failed: ${error}`, 400);
    }

    if (!code || !state) {
      return c.text("Missing parameters", 400);
    }

    const pending = await deps.pendingFlows.consume(state);
    if (!pending) {
      securityLog("warn", "identity.link.denied", {
        category: "channel",
        actor: null,
        actorKind: "external",
        surface: "slack",
        decision: "deny",
        reason: "invalid-state",
      });
      return c.text("Invalid or expired state", 400);
    }

    const isBind = pending.intent === "bind";

    if (Date.now() - pending.createdAt > FLOW_TTL_MS) {
      return isBind
        ? c.redirect(`${bindPage}?error=expired`)
        : c.text(
            `Login link expired. Run \`/${deps.brandShort} login\` again.`,
            400,
          );
    }

    const result = await exchangeCodeForTokens(
      deps.oauthConfig,
      code,
      pending.codeVerifier,
    );
    if ("error" in result) {
      process.stderr.write(`[slack-oauth] ${result.error}\n`);
      return isBind
        ? c.redirect(`${bindPage}?error=exchange_failed`)
        : c.text(
            `Token exchange failed. Run \`/${deps.brandShort} login\` again.`,
            400,
          );
    }

    await deps.identityLinks.link(
      "slack",
      pending.slackUserId,
      result.keycloakSub,
    );
    securityLog("info", "identity.link", {
      category: "channel",
      actor: result.keycloakSub,
      actorKind: "user",
      surface: "slack",
      result: "success",
      detail: {
        externalUserId: pending.slackUserId,
      },
    });

    if (isBind) {
      const flowId = await deps.bindFlows.create({
        slackChannelId: pending.channelId,
        slackUserId: pending.slackUserId,
        keycloakSub: result.keycloakSub,
      });
      return c.redirect(`${bindPage}?flow=${flowId}`);
    }

    return c.html(
      "<html><body><h2>Account linked!</h2><p>You can close this window and return to Slack.</p></body></html>",
    );
  });

  return routes;
}

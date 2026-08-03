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

/** Completes the Slack Keycloak roundtrip for both the `login` intent (identity
 *  linking, today's behavior) and the `bind` intent (in-chat channel bind). A
 *  bind callback links the identity too — so the binder can later run the
 *  unbind command without re-authenticating — then mints a bind flow pinned to
 *  the authenticated sub and hands the user to the UI agent picker, which does
 *  the ownership check and the write. */
export function createSlackOAuthRoutes(deps: {
  pendingFlows: TtlStore<SlackOAuthPending>;
  bindFlows: SlackBindFlowStore;
  identityLinks: IdentityLinkService;
  oauthConfig: KeycloakOAuthConfig;
  uiBaseUrl: string;
  /** Lowercase brand identifier — used to render the slash command name in
   *  user-facing error messages ("Run `/<brandShort> login` again"). */
  brandShort: string;
}) {
  const routes = new Hono();
  const bindPage = `${deps.uiBaseUrl}/slack/bind`;

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

    const pending = await deps.pendingFlows.consume(state);
    if (!pending) {
      // Invalid/replayed state on a public callback — a CSRF/replay probe.
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

    // From here the intent is known, so bind failures land on the picker page
    // (with an ?error=) while login failures keep the plain-text response.
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
    // The primary "who got bound to which Keycloak account" record. A bind
    // callback links the identity too so the binder can later unbind in-chat.
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

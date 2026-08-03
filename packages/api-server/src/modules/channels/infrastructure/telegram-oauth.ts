import { Hono } from "hono";
import type {
  TelegramOAuthPending,
  TelegramBindFlowStore,
} from "./telegram-flows.js";
import {
  exchangeCodeForTokens,
  type KeycloakOAuthConfig,
} from "./identity-oauth.js";

const FLOW_TTL_MS = 10 * 60 * 1000;

/** Completes the bind Keycloak roundtrip. The callback writes nothing
 *  durable: it verifies the login, mints a bind flow pinned to the
 *  authenticated sub, and hands the user to the UI agent picker — the bind
 *  mutation does the ownership check and the write. Every human-visible
 *  outcome lands on the one picker page. */
export function createTelegramOAuthRoutes(deps: {
  pendingFlows: Map<string, TelegramOAuthPending>;
  bindFlows: TelegramBindFlowStore;
  oauthConfig: KeycloakOAuthConfig;
  uiBaseUrl: string;
}) {
  const routes = new Hono();
  const bindPage = `${deps.uiBaseUrl}/telegram/bind`;

  routes.get("/api/telegram/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.redirect(`${bindPage}?error=denied`);
    }

    if (!code || !state) {
      return c.text("Missing parameters", 400);
    }

    const pending = deps.pendingFlows.get(state);
    if (!pending) {
      // Unknown and replayed states read the same as expired — no oracle.
      return c.redirect(`${bindPage}?error=expired`);
    }

    if (Date.now() - pending.createdAt > FLOW_TTL_MS) {
      deps.pendingFlows.delete(state);
      return c.redirect(`${bindPage}?error=expired`);
    }

    // Consume before the exchange so a failed exchange still invalidates
    // the state.
    deps.pendingFlows.delete(state);

    const result = await exchangeCodeForTokens(
      deps.oauthConfig,
      code,
      pending.codeVerifier,
    );
    if ("error" in result) {
      process.stderr.write(`[telegram-oauth] ${result.error}\n`);
      return c.redirect(`${bindPage}?error=exchange_failed`);
    }

    const flowId = deps.bindFlows.create({
      conversationId: pending.threadId,
      telegramUserId: pending.telegramUserId,
      keycloakSub: result.keycloakSub,
      ...(pending.chatTitle !== undefined
        ? { chatTitle: pending.chatTitle }
        : {}),
    });

    return c.redirect(`${bindPage}?flow=${flowId}`);
  });

  return routes;
}

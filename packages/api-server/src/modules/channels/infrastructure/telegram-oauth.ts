import type { TtlStore } from "../../../core/ttl-store.js";
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

export function createTelegramOAuthRoutes(deps: {
  pendingFlows: TtlStore<TelegramOAuthPending>;
  bindFlows: TelegramBindFlowStore;
  oauthConfig: KeycloakOAuthConfig;
  uiBaseUrl: string;
}) {
  const routes = new Hono();
  const bindPage = `${deps.uiBaseUrl}/telegram/bind`;

  routes.get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.redirect(`${bindPage}?error=denied`);
    }

    if (!code || !state) {
      return c.text("Missing parameters", 400);
    }

    const pending = await deps.pendingFlows.consume(state);
    if (!pending) {
      return c.redirect(`${bindPage}?error=expired`);
    }

    if (Date.now() - pending.createdAt > FLOW_TTL_MS) {
      return c.redirect(`${bindPage}?error=expired`);
    }

    const result = await exchangeCodeForTokens(
      deps.oauthConfig,
      code,
      pending.codeVerifier,
    );
    if ("error" in result) {
      process.stderr.write(`[telegram-oauth] ${result.error}\n`);
      return c.redirect(`${bindPage}?error=exchange_failed`);
    }

    const flowId = await deps.bindFlows.create({
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

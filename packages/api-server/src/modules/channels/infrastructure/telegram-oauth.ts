import { Hono } from "hono";
import type { TelegramOAuthPending, TelegramThreadsRepo } from "./telegram.js";
import {
  exchangeCodeForTokens,
  type KeycloakOAuthConfig,
} from "./identity-oauth.js";

const FLOW_TTL_MS = 10 * 60 * 1000;

export function createTelegramOAuthRoutes(deps: {
  pendingFlows: Map<string, TelegramOAuthPending>;
  threads: TelegramThreadsRepo;
  isAgentOwner: (agentId: string, keycloakSub: string) => Promise<boolean>;
  oauthConfig: KeycloakOAuthConfig;
}) {
  const routes = new Hono();

  routes.get("/api/telegram/oauth/callback", async (c) => {
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
      return c.text("Login link expired. Send /login again.", 400);
    }

    deps.pendingFlows.delete(state);

    const result = await exchangeCodeForTokens(
      deps.oauthConfig,
      code,
      pending.codeVerifier,
    );
    if ("error" in result) {
      process.stderr.write(`[telegram-oauth] ${result.error}\n`);
      return c.text("Token exchange failed. Send /login again.", 400);
    }

    const isOwner = await deps.isAgentOwner(
      pending.instanceName,
      result.keycloakSub,
    );
    if (!isOwner) {
      return c.text(
        "You must log in as the instance owner to authorize this conversation.",
        403,
      );
    }

    await deps.threads.authorize(
      pending.instanceName,
      pending.threadId,
      pending.telegramUserId,
    );

    return c.html(
      "<html><body><h2>Conversation authorized!</h2><p>You can close this window and return to Telegram.</p></body></html>",
    );
  });

  return routes;
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTelegramOAuthRoutes } from "../../modules/channels/infrastructure/telegram-oauth.js";
import {
  createTelegramBindFlowStore,
  type TelegramOAuthPending,
} from "../../modules/channels/infrastructure/telegram-flows.js";
import type { KeycloakOAuthConfig } from "../../modules/channels/infrastructure/identity-oauth.js";

const exchangeCodeForTokens = vi.fn();

vi.mock("../../modules/channels/infrastructure/identity-oauth.js", () => ({
  exchangeCodeForTokens: (...args: unknown[]) => exchangeCodeForTokens(...args),
}));

const TELEGRAM_USER_ID = "999000111";
const KEYCLOAK_SUB = "kc-sub-abc";
const UI = "https://app.example";

const oauthConfig: KeycloakOAuthConfig = {
  keycloakExternalUrl: "https://kc.example",
  keycloakUrl: "https://kc.internal",
  keycloakRealm: "platform",
  keycloakClientId: "telegram",
  callbackUrl: `${UI}/api/telegram/oauth/callback`,
};

function makeHarness(opts?: { pendingCreatedAt?: number }) {
  const pendingFlows = new Map<string, TelegramOAuthPending>();
  pendingFlows.set("state-1", {
    telegramUserId: TELEGRAM_USER_ID,
    threadId: "chat-123",
    codeVerifier: "verifier",
    chatTitle: "Team chat",
    createdAt: opts?.pendingCreatedAt ?? Date.now(),
  });

  const bindFlows = createTelegramBindFlowStore();
  const routes = createTelegramOAuthRoutes({
    pendingFlows,
    bindFlows,
    oauthConfig,
    uiBaseUrl: UI,
  });

  return { routes, pendingFlows, bindFlows };
}

describe("telegram oauth callback", () => {
  beforeEach(() => {
    exchangeCodeForTokens.mockReset();
  });

  it("mints a sub-pinned bind flow and redirects to the picker", async () => {
    const h = makeHarness();
    exchangeCodeForTokens.mockResolvedValue({ keycloakSub: KEYCLOAK_SUB });

    const res = await h.routes.request(
      "/api/telegram/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location.startsWith(`${UI}/telegram/bind?flow=`)).toBe(true);

    const flowId = new URL(location).searchParams.get("flow")!;
    // The flow pins the AUTHENTICATED sub, not the Telegram user id — the
    // bind mutation matches it against the UI session's sub.
    expect(h.bindFlows.peek(flowId)).toMatchObject({
      conversationId: "chat-123",
      telegramUserId: TELEGRAM_USER_ID,
      keycloakSub: KEYCLOAK_SUB,
      chatTitle: "Team chat",
    });
    expect(h.pendingFlows.has("state-1")).toBe(false);
  });

  it("redirects unknown or replayed states to the expired page", async () => {
    const h = makeHarness();

    const res = await h.routes.request(
      "/api/telegram/oauth/callback?code=abc&state=nope",
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${UI}/telegram/bind?error=expired`,
    );
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("expires stale pending flows", async () => {
    const h = makeHarness({ pendingCreatedAt: Date.now() - 11 * 60 * 1000 });

    const res = await h.routes.request(
      "/api/telegram/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${UI}/telegram/bind?error=expired`,
    );
    expect(h.pendingFlows.has("state-1")).toBe(false);
  });

  it("consumes the pending flow and mints nothing on token-exchange failure", async () => {
    const h = makeHarness();
    exchangeCodeForTokens.mockResolvedValue({ error: "invalid_grant" });

    const res = await h.routes.request(
      "/api/telegram/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${UI}/telegram/bind?error=exchange_failed`,
    );
    expect(h.pendingFlows.has("state-1")).toBe(false);
  });

  it("routes a user-denied Keycloak login to the picker's error state", async () => {
    const h = makeHarness();

    const res = await h.routes.request(
      "/api/telegram/oauth/callback?error=access_denied",
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${UI}/telegram/bind?error=denied`,
    );
  });
});

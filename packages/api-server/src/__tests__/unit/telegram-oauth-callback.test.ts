import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTelegramOAuthRoutes } from "../../modules/channels/infrastructure/telegram-oauth.js";
import type {
  TelegramOAuthPending,
  TelegramThreadsRepo,
} from "../../modules/channels/infrastructure/telegram.js";
import type { KeycloakOAuthConfig } from "../../modules/channels/infrastructure/identity-oauth.js";

const exchangeCodeForTokens = vi.fn();

vi.mock("../../modules/channels/infrastructure/identity-oauth.js", () => ({
  exchangeCodeForTokens: (...args: unknown[]) => exchangeCodeForTokens(...args),
}));

const TELEGRAM_USER_ID = "999000111";
const KEYCLOAK_SUB = "kc-sub-abc";

const oauthConfig: KeycloakOAuthConfig = {
  keycloakExternalUrl: "https://kc.example",
  keycloakUrl: "https://kc.internal",
  keycloakRealm: "platform",
  keycloakClientId: "telegram",
  callbackUrl: "https://app.example/api/telegram/oauth/callback",
};

interface Harness {
  routes: ReturnType<typeof createTelegramOAuthRoutes>;
  authorizeCalls: Array<{
    agentId: string;
    threadId: string;
    authorizedBy: string;
  }>;
  pendingFlows: Map<string, TelegramOAuthPending>;
}

function makeHarness(opts: { isOwner: boolean }): Harness {
  const authorizeCalls: Harness["authorizeCalls"] = [];
  const pendingFlows = new Map<string, TelegramOAuthPending>();
  pendingFlows.set("state-1", {
    instanceName: "agent-1",
    telegramUserId: TELEGRAM_USER_ID,
    threadId: "chat-123",
    codeVerifier: "verifier",
    createdAt: Date.now(),
  });

  const threads: TelegramThreadsRepo = {
    isAuthorized: async () => false,
    authorize: async (agentId, threadId, authorizedBy) => {
      authorizeCalls.push({ agentId, threadId, authorizedBy });
    },
    list: async () => [],
    revoke: async () => {},
    getAuthorizedBy: async () => null,
  };

  const routes = createTelegramOAuthRoutes({
    pendingFlows,
    threads,
    isAgentOwner: async () => opts.isOwner,
    oauthConfig,
  });

  return { routes, authorizeCalls, pendingFlows };
}

describe("telegram oauth callback", () => {
  beforeEach(() => {
    exchangeCodeForTokens.mockReset();
  });

  // Regression for the terms-of-use gate (ADR-047): the inbound gate calls
  // isTermsAccepted(authorizedBy), which is keyed on the Keycloak sub. The
  // callback must persist the sub — persisting the Telegram user ID would make
  // the gate block every message regardless of UI acceptance.
  it("stores the Keycloak sub as authorizedBy, not the Telegram user ID", async () => {
    const { routes, authorizeCalls } = makeHarness({ isOwner: true });
    exchangeCodeForTokens.mockResolvedValue({ keycloakSub: KEYCLOAK_SUB });

    const res = await routes.request(
      "/api/telegram/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(200);
    expect(authorizeCalls).toHaveLength(1);
    expect(authorizeCalls[0]).toMatchObject({
      agentId: "agent-1",
      threadId: "chat-123",
      authorizedBy: KEYCLOAK_SUB,
    });
    expect(authorizeCalls[0].authorizedBy).not.toBe(TELEGRAM_USER_ID);
  });

  it("rejects a non-owner and does not authorize the thread", async () => {
    const { routes, authorizeCalls } = makeHarness({ isOwner: false });
    exchangeCodeForTokens.mockResolvedValue({ keycloakSub: KEYCLOAK_SUB });

    const res = await routes.request(
      "/api/telegram/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(403);
    expect(authorizeCalls).toHaveLength(0);
  });

  it("consumes the pending flow and does not authorize on token-exchange failure", async () => {
    const { routes, authorizeCalls, pendingFlows } = makeHarness({
      isOwner: true,
    });
    exchangeCodeForTokens.mockResolvedValue({ error: "invalid_grant" });

    const res = await routes.request(
      "/api/telegram/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(400);
    expect(authorizeCalls).toHaveLength(0);
    expect(pendingFlows.has("state-1")).toBe(false);
  });
});

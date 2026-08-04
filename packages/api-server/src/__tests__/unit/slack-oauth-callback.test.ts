import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { createInspectableTtlStore } from "../helpers/ttl-store.js";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSlackOAuthRoutes } from "../../modules/channels/infrastructure/slack-oauth.js";
import { createSlackBindFlowStore } from "../../modules/channels/infrastructure/slack-flows.js";
import type { SlackOAuthPending } from "../../modules/channels/infrastructure/slack.js";
import type { IdentityLinkService } from "../../modules/channels/services/identity-link-service.js";
import type { KeycloakOAuthConfig } from "../../modules/channels/infrastructure/identity-oauth.js";
import { configureLogger } from "../../core/logger.js";

const exchangeCodeForTokens = vi.fn();

vi.mock("../../modules/channels/infrastructure/identity-oauth.js", () => ({
  exchangeCodeForTokens: (...args: unknown[]) => exchangeCodeForTokens(...args),
}));

configureLogger({ level: "error", write: () => {} });

const SLACK_USER_ID = "U-42";
const KEYCLOAK_SUB = "kc-sub-abc";
const UI = "https://app.example";

const oauthConfig: KeycloakOAuthConfig = {
  keycloakExternalUrl: "https://kc.example",
  keycloakUrl: "https://kc.internal",
  keycloakRealm: "platform",
  keycloakClientId: "slack",
  callbackUrl: `${UI}/api/slack/oauth/callback`,
};

function makeHarness(opts: {
  intent: "login" | "bind";
  pendingCreatedAt?: number;
}) {
  const { store: pendingFlows, map: pendingFlowsMap } =
    createInspectableTtlStore<SlackOAuthPending>();
  pendingFlowsMap.set("state-1", {
    slackUserId: SLACK_USER_ID,
    channelId: "C-123",
    codeVerifier: "verifier",
    intent: opts.intent,
    createdAt: opts.pendingCreatedAt ?? Date.now(),
  });

  const bindFlows = createSlackBindFlowStore({
    store: createMemoryTtlStore(600_000),
  });
  const link = vi.fn(async () => {});
  const identityLinks = { link } as unknown as IdentityLinkService;

  const routes = createSlackOAuthRoutes({
    pendingFlows,
    bindFlows,
    identityLinks,
    oauthConfig,
    uiBaseUrl: UI,
    brandShort: "dam",
  });

  return { routes, pendingFlows, pendingFlowsMap, bindFlows, link };
}

describe("slack oauth callback — bind intent", () => {
  beforeEach(() => exchangeCodeForTokens.mockReset());

  it("links identity, mints a sub-pinned bind flow, and redirects to the picker", async () => {
    const h = makeHarness({ intent: "bind" });
    exchangeCodeForTokens.mockResolvedValue({ keycloakSub: KEYCLOAK_SUB });

    const res = await h.routes.request(
      "/api/slack/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location.startsWith(`${UI}/slack/bind?flow=`)).toBe(true);

    const flowId = new URL(location).searchParams.get("flow")!;
    expect(await h.bindFlows.peek(flowId)).toMatchObject({
      slackChannelId: "C-123",
      slackUserId: SLACK_USER_ID,
      keycloakSub: KEYCLOAK_SUB,
    });
    // The binder is identity-linked too, so they can later /unbind in-chat.
    expect(h.link).toHaveBeenCalledWith("slack", SLACK_USER_ID, KEYCLOAK_SUB);
    expect(h.pendingFlowsMap.has("state-1")).toBe(false);
  });

  it("redirects to the picker error page on token-exchange failure", async () => {
    const h = makeHarness({ intent: "bind" });
    exchangeCodeForTokens.mockResolvedValue({ error: "invalid_grant" });

    const res = await h.routes.request(
      "/api/slack/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${UI}/slack/bind?error=exchange_failed`,
    );
    expect(h.pendingFlowsMap.has("state-1")).toBe(false);
  });

  it("expires a stale bind pending flow to the picker error page", async () => {
    const h = makeHarness({
      intent: "bind",
      pendingCreatedAt: Date.now() - 11 * 60 * 1000,
    });

    const res = await h.routes.request(
      "/api/slack/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${UI}/slack/bind?error=expired`);
  });
});

describe("slack oauth callback — login intent (unchanged)", () => {
  beforeEach(() => exchangeCodeForTokens.mockReset());

  it("links identity and returns the HTML page, minting no bind flow", async () => {
    const h = makeHarness({ intent: "login" });
    exchangeCodeForTokens.mockResolvedValue({ keycloakSub: KEYCLOAK_SUB });

    const res = await h.routes.request(
      "/api/slack/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Account linked");
    expect(h.link).toHaveBeenCalledWith("slack", SLACK_USER_ID, KEYCLOAK_SUB);
  });

  it("keeps the plain-text failure for a login token-exchange failure", async () => {
    const h = makeHarness({ intent: "login" });
    exchangeCodeForTokens.mockResolvedValue({ error: "invalid_grant" });

    const res = await h.routes.request(
      "/api/slack/oauth/callback?code=abc&state=state-1",
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Token exchange failed");
  });
});

describe("slack oauth callback — shared guards", () => {
  beforeEach(() => exchangeCodeForTokens.mockReset());

  it("rejects an unknown/replayed state without exchanging", async () => {
    const h = makeHarness({ intent: "bind" });

    const res = await h.routes.request(
      "/api/slack/oauth/callback?code=abc&state=nope",
    );

    expect(res.status).toBe(400);
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });
});

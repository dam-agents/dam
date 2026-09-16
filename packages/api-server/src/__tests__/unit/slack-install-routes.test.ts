import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { ApiVariables } from "../../apps/api-server/deps.js";
import { createInspectableTtlStore } from "../helpers/ttl-store.js";
import {
  createSlackInstallRoutes,
  SLACK_INSTALL_BOT_SCOPES,
  type SlackInstallPending,
} from "../../modules/channels/infrastructure/slack-install-routes.js";
import type { SlackInstallService } from "../../modules/channels/services/slack-install-service.js";
import { configureLogger } from "../../core/logger.js";

/**
 * TEST_OVERVIEW: The install handshake, which is the one part of connecting a
 * Slack workspace that no other test reaches — the e2e suite registers a
 * workspace directly, because only Slack can drive a real consent screen. It
 * is also the part a person runs once, by hand, with a workspace admin
 * waiting, so a wrong branch here surfaces as a stranger's failed consent
 * rather than a failing build.
 *
 * What the route has to hold: only an operator may start an install, the
 * state that comes back must be one this platform issued and may be spent
 * only once, and a workspace is recorded only when Slack actually mints a
 * token for it.
 */

configureLogger({ level: "error", write: () => {} });

const INSTALLER_ROLE = "platform-slack-installer";
const OPERATOR = "kc|operator-1";
const CALLBACK = "https://platform.example/api/slack/install/callback";

function harness(opts?: { roles?: string[]; enterpriseId?: string }) {
  const { store: pendingInstalls, map: pending } =
    createInspectableTtlStore<SlackInstallPending>();
  const recorded: { teamId: string; installedBy: string | null }[] = [];
  const installs = {
    record: async (install: { teamId: string; installedBy: string | null }) => {
      recorded.push({
        teamId: install.teamId,
        installedBy: install.installedBy,
      });
      return "platform-secret-slack-install-abc";
    },
  } as unknown as SlackInstallService;

  const routes = new Hono<{ Variables: ApiVariables }>()
    .use("*", async (c, next) => {
      c.set("roles", opts?.roles ?? [INSTALLER_ROLE]);
      c.set("user", {
        sub: OPERATOR,
        preferredUsername: "operator",
        scopes: [],
        agentIds: "*",
      });
      await next();
    })
    .route(
      "/api/slack",
      createSlackInstallRoutes({
        pendingInstalls,
        installs,
        installerRole: INSTALLER_ROLE,
        brandName: "DAM",
        oauth: {
          clientId: "client-1",
          clientSecret: "secret-1",
          callbackUrl: CALLBACK,
          scopes: SLACK_INSTALL_BOT_SCOPES,
          enterpriseId: opts?.enterpriseId ?? "",
        },
      }),
    );

  return { routes, pending, recorded };
}

function slackReplies(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body))),
  );
}

describe("slack install routes", () => {
  beforeEach(() => vi.unstubAllGlobals());

  /**
   * TEST_SCENARIO: Connecting a workspace is install-wide, not something one
   * agent's owner decides, so a signed-in user without the operator role is
   * refused before any state is minted.
   */
  it("refuses to start an install without the installer role", async () => {
    const h = harness({ roles: ["some-other-role"] });

    const res = await h.routes.request("/api/slack/install/start");

    expect(res.status).toBe(403);
    expect(h.pending.size).toBe(0);
  });

  /**
   * TEST_SCENARIO: The UI asks whether to show the install surface at all.
   * Unlike the start route this answers rather than refuses — a 403 carries no
   * information a UI can render — so a non-installer must get a plain `false`
   * and an installer a plain `true`.
   */
  it("tells the UI who may install, without refusing either of them", async () => {
    const asInstaller = await harness().routes.request(
      "/api/slack/install/status",
    );
    const asStranger = await harness({
      roles: ["some-other-role"],
    }).routes.request("/api/slack/install/status");

    expect(asInstaller.status).toBe(200);
    expect(await asInstaller.json()).toEqual({ canInstall: true });
    expect(asStranger.status).toBe(200);
    expect(await asStranger.json()).toEqual({ canInstall: false });
  });

  /**
   * TEST_SCENARIO: An operator gets the consent URL as a value rather than a
   * redirect — a browser navigation carries no bearer token, so a gated
   * redirect could never be followed. The state travels with it and is
   * remembered against the operator who asked.
   */
  it("hands an operator a consent URL and remembers who started it", async () => {
    const h = harness();

    const res = await h.routes.request("/api/slack/install/start");
    expect(res.status).toBe(200);

    const { url } = (await res.json()) as { url: string };
    const authorize = new URL(url);
    expect(authorize.origin + authorize.pathname).toBe(
      "https://slack.com/oauth/v2/authorize",
    );
    expect(authorize.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(authorize.searchParams.get("scope")).toContain("assistant:write");

    const state = authorize.searchParams.get("state")!;
    expect(h.pending.get(state)?.startedBy).toBe(OPERATOR);
  });

  /**
   * TEST_SCENARIO: A consent redirect this platform never issued. Slack's own
   * app page sends one with no state at all, which is what the original
   * failure looked like; either way nothing is exchanged and no workspace is
   * recorded.
   */
  it("refuses a callback with no state, and one this platform never issued", async () => {
    const h = harness();

    expect(
      (await h.routes.request("/api/slack/install/callback?code=x")).status,
    ).toBe(400);
    expect(
      (
        await h.routes.request(
          "/api/slack/install/callback?code=x&state=not-ours",
        )
      ).status,
    ).toBe(400);
    expect(h.recorded).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A state is spent once. Replaying a captured callback must
   * not connect the workspace a second time under someone else's hand.
   */
  it("spends a state only once", async () => {
    const h = harness();
    slackReplies({
      ok: true,
      access_token: "xoxb-new",
      team: { id: "T-NEW", name: "New" },
    });
    const start = await h.routes.request("/api/slack/install/start");
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    const first = await h.routes.request(
      `/api/slack/install/callback?code=abc&state=${state}`,
    );
    const replay = await h.routes.request(
      `/api/slack/install/callback?code=abc&state=${state}`,
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(400);
    expect(h.recorded).toEqual([{ teamId: "T-NEW", installedBy: OPERATOR }]);
  });

  /**
   * TEST_SCENARIO: Slack refuses the exchange — a reused code, or a client
   * secret that does not match. Nothing is recorded, so a workspace never
   * exists with a token that was never minted.
   */
  it("records nothing when Slack refuses the exchange", async () => {
    const h = harness();
    slackReplies({ ok: false, error: "invalid_code" });
    const start = await h.routes.request("/api/slack/install/start");
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    const res = await h.routes.request(
      `/api/slack/install/callback?code=abc&state=${state}`,
    );

    expect(res.status).toBe(400);
    expect(h.recorded).toEqual([]);
  });

  /**
   * TEST_SCENARIO: An install configured for one Slack organization is offered
   * a workspace from outside it. Several reads downstream hold that a
   * conversation id and a user id each name one thing, which is true only
   * inside one organization, so the workspace is refused where the credential
   * would be accepted rather than left for those reads to get wrong.
   */
  it("refuses a workspace outside the organization it is configured for", async () => {
    const h = harness({ enterpriseId: "E-OURS" });
    slackReplies({
      ok: true,
      access_token: "xoxb-outsider",
      team: { id: "T-OUTSIDE", name: "Someone else" },
      enterprise: { id: "E-THEIRS" },
    });
    const start = await h.routes.request("/api/slack/install/start");
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    const res = await h.routes.request(
      `/api/slack/install/callback?code=abc&state=${state}`,
    );

    expect(res.status).toBe(403);
    expect(h.recorded).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The same workspace, on an install that names no
   * organization — the only thing a standalone Slack app can do, since Slack
   * reports no organization for one. The check has to be off rather than
   * refusing everything.
   */
  it("accepts any workspace when no organization is configured", async () => {
    const h = harness();
    slackReplies({
      ok: true,
      access_token: "xoxb-standalone",
      team: { id: "T-STANDALONE", name: "Standalone" },
    });
    const start = await h.routes.request("/api/slack/install/start");
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    const res = await h.routes.request(
      `/api/slack/install/callback?code=abc&state=${state}`,
    );

    expect(res.status).toBe(200);
    expect(h.recorded).toEqual([
      { teamId: "T-STANDALONE", installedBy: OPERATOR },
    ]);
  });

  /**
   * TEST_SCENARIO: The exchange itself fails — a proxy answering with
   * something that is not JSON. It must read as a refused install rather than
   * escaping the handler as a 500.
   */
  it("treats an unreadable exchange as a refused install", async () => {
    const h = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>")),
    );
    const start = await h.routes.request("/api/slack/install/start");
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    const res = await h.routes.request(
      `/api/slack/install/callback?code=abc&state=${state}`,
    );

    expect(res.status).toBe(400);
    expect(h.recorded).toEqual([]);
  });
});

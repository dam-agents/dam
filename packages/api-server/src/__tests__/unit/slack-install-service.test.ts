import { describe, it, expect } from "vitest";
import {
  createSlackInstallService,
  type SlackInstallServiceDeps,
} from "../../modules/channels/services/slack-install-service.js";
import type { SlackInstall } from "../../modules/channels/infrastructure/slack-installs-repository.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type { SlackTokenGrant } from "../../modules/channels/infrastructure/slack-token-rotation.js";

/**
 * TEST_OVERVIEW: Which credential answers for a Slack workspace.
 *
 * Every workspace's token sits in a Secret its row points at, and a workspace
 * with no row is answered by nothing. A bot token still set in Helm values is
 * imported once into its workspace's row, and the bindings made before
 * multi-workspace support — which name no workspace — are moved onto it, after
 * which nothing about that workspace differs from any other. Rotating tokens
 * are refreshed shortly before expiry and tokens that do not expire are
 * exchanged when exchanging is on.
 */

const ENV_TOKEN = "xoxb-from-helm";
const ORIGINAL_TEAM = "T-ORIGINAL";

function service(opts?: {
  installs?: Record<string, SlackInstall>;
  secrets?: Record<string, string | Record<string, string>>;
  refreshToken?: SlackTokenGrant;
  exchangeToken?: SlackTokenGrant;
  bindings?: { channel: string; teamId: string }[];
  now?: () => number;
}) {
  const installs: Record<string, SlackInstall> = { ...opts?.installs };
  const stored: Record<string, Record<string, string>> = {};
  for (const [path, value] of Object.entries(opts?.secrets ?? {})) {
    stored[path] = typeof value === "string" ? { botToken: value } : value;
  }
  const states: Record<string, string> = {};
  const bindings = (opts?.bindings ?? []).map((b) => ({ ...b }));
  const deps: SlackInstallServiceDeps = {
    find: async (teamId) => installs[teamId] ?? null,
    list: async () => Object.values(installs),
    upsert: async (row) => {
      installs[row.teamId] = { ...row, credentialState: "active" };
    },
    claimUnscopedBindings: async (teamId) => {
      let claimed = 0;
      for (const binding of bindings) {
        if (binding.teamId === "") {
          binding.teamId = teamId;
          claimed++;
        }
      }
      return claimed;
    },
    setState: async (teamId, state) => {
      states[teamId] = state;
    },
    installLock: async (_key, run) => run(),
    refreshToken: opts?.refreshToken ?? null,
    exchangeToken: opts?.exchangeToken ?? null,
    ...(opts?.now ? { now: opts.now } : {}),
    secrets: {
      storeId: "k8s",
      get: async ({ path }: { path: string }) =>
        stored[path] ? { ...stored[path] } : null,
      mintRef: () => ({
        storeId: "k8s",
        path: `minted-${Object.keys(stored).length}`,
      }),
      put: async (
        { path }: { path: string },
        fields: Record<string, string>,
      ) => {
        stored[path] = { ...fields };
      },
      putFields: async (
        { path }: { path: string },
        fields: Record<string, string>,
      ) => {
        stored[path] = { ...stored[path], ...fields };
      },
    } as unknown as SecretStore,
  };
  return {
    svc: createSlackInstallService(deps),
    stored,
    states,
    installs,
    bindings,
  };
}

function installRow(teamId: string, secretPath: string): SlackInstall {
  return {
    teamId,
    teamName: null,
    secretPath,
    secretField: "botToken",
    installedBy: null,
    credentialState: "active",
  };
}

describe("slack install service — which credential answers", () => {
  /**
   * TEST_SCENARIO: An install upgrading from a Helm token. The token becomes
   * its workspace's row, and every binding that named no workspace now names
   * that one, so they route the same as any binding made since.
   */
  it("imports the Helm token into a row and moves unscoped bindings onto it", async () => {
    const { svc, installs, stored, bindings } = service({
      bindings: [
        { channel: "C-OLD", teamId: "" },
        { channel: "C-SECOND", teamId: "T-SECOND" },
      ],
    });

    await svc.importHelmToken(ORIGINAL_TEAM, ENV_TOKEN);

    expect(stored[installs[ORIGINAL_TEAM]!.secretPath]).toEqual({
      botToken: ENV_TOKEN,
    });
    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBe(ENV_TOKEN);
    expect(bindings).toEqual([
      { channel: "C-OLD", teamId: ORIGINAL_TEAM },
      { channel: "C-SECOND", teamId: "T-SECOND" },
    ]);
  });

  /**
   * TEST_SCENARIO: The workspace re-authorized through the handshake before
   * the upgrade, so its row already holds a newer token than Helm's. The row is
   * kept as it is; only the bindings are moved.
   */
  it("keeps an existing row rather than overwrite it with the Helm token", async () => {
    const { svc, stored, bindings } = service({
      installs: {
        [ORIGINAL_TEAM]: installRow(ORIGINAL_TEAM, "secret-original"),
      },
      secrets: { "secret-original": "xoxb-reauthorized" },
      bindings: [{ channel: "C-OLD", teamId: "" }],
    });

    await svc.importHelmToken(ORIGINAL_TEAM, ENV_TOKEN);

    expect(stored["secret-original"]).toEqual({
      botToken: "xoxb-reauthorized",
    });
    expect(bindings).toEqual([{ channel: "C-OLD", teamId: ORIGINAL_TEAM }]);
  });

  /**
   * TEST_SCENARIO: A workspace this platform has no row for. Slack installs the
   * app the moment an admin consents, so such a workspace can exist and send
   * events; it is answered for by nothing — and neither is the empty string,
   * which names no workspace at all.
   */
  it("gives no token to a workspace it has no row for", async () => {
    const { svc } = service();

    expect(await svc.resolveBotToken("T-STRANGER")).toBeNull();
    expect(await svc.resolveBotToken("")).toBeNull();
  });

  /**
   * TEST_SCENARIO: A workspace whose credential Slack has rejected keeps its
   * row so that re-authorizing can clear the mark, but is served nothing in the
   * meantime.
   */
  it("serves nothing for a workspace whose credential was rejected", async () => {
    const { svc } = service({
      installs: {
        "T-SECOND": {
          ...installRow("T-SECOND", "secret-second"),
          credentialState: "rejected",
        },
      },
      secrets: { "secret-second": "xoxb-second" },
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBeNull();
  });

  /**
   * TEST_SCENARIO: Another workspace, which has nothing to do with the operator
   * token, resolves through its own row.
   */
  it("serves a second workspace from its own install row", async () => {
    const { svc } = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": "xoxb-second" },
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBe("xoxb-second");
  });
});

describe("slack install service — rotating tokens", () => {
  const HOUR = 60 * 60_000;
  const T0 = 1_000_000_000_000;

  function rotating(expiresAt: number) {
    return {
      botToken: "xoxe.xoxb-old",
      refreshToken: "xoxe-1-old",
      expiresAt: String(expiresAt),
    };
  }

  /**
   * TEST_SCENARIO: A rotating token less than an hour old is served as it is;
   * nothing is spent refreshing it.
   */
  it("serves a rotating token less than an hour old", async () => {
    let refreshed = 0;
    const { svc } = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": rotating(T0 + 11.5 * HOUR) },
      now: () => T0,
      refreshToken: async () => {
        refreshed++;
        return { ok: false, refusal: null, error: "unexpected" };
      },
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBe("xoxe.xoxb-old");
    expect(refreshed).toBe(0);
  });

  /**
   * TEST_SCENARIO: Once the token is an hour old it is swapped for a new one, and
   * the new refresh token is stored beside it — the old one is single-use, so
   * losing the new one would strand the workspace at the next expiry.
   */
  it("refreshes a token an hour old and stores the new pair", async () => {
    const spent: string[] = [];
    const { svc, stored } = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": rotating(T0 + 10 * 60_000) },
      now: () => T0,
      refreshToken: async (refreshToken: string) => {
        spent.push(refreshToken);
        return {
          ok: true,
          accessToken: "xoxe.xoxb-new",
          refreshToken: "xoxe-1-new",
          expiresAt: T0 + 12 * HOUR,
        };
      },
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBe("xoxe.xoxb-new");
    expect(spent).toEqual(["xoxe-1-old"]);
    expect(stored["secret-second"]).toEqual({
      botToken: "xoxe.xoxb-new",
      refreshToken: "xoxe-1-new",
      expiresAt: String(T0 + 12 * HOUR),
    });
  });

  /**
   * TEST_SCENARIO: A refresh that fails while the current token still works
   * keeps serving that token — a Slack hiccup must not take the workspace
   * down hours before it has to.
   */
  it("keeps serving the current token when a refresh fails before expiry", async () => {
    const { svc, states } = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": rotating(T0 + 10 * 60_000) },
      now: () => T0,
      refreshToken: async () => ({
        ok: false,
        refusal: "invalid_refresh_token",
        error: "invalid_refresh_token",
      }),
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBe("xoxe.xoxb-old");
    expect(states["T-SECOND"]).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: Once the token has expired and Slack refuses the refresh,
   * the credential is dead and is marked like any other rejection, so
   * re-authorizing is what brings the workspace back.
   */
  it("marks the credential once it has expired and Slack refuses the refresh", async () => {
    const { svc, states } = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": rotating(T0 - 1) },
      now: () => T0,
      refreshToken: async () => ({
        ok: false,
        refusal: "invalid_refresh_token",
        error: "invalid_refresh_token",
      }),
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBeNull();
    expect(states["T-SECOND"]).toBe("rejected");
  });

  /**
   * TEST_SCENARIO: Slack not answering is not a refusal: an expired token is
   * not served, but the credential is left unmarked so the next attempt can
   * still refresh it.
   */
  it("leaves an expired credential unmarked when Slack does not answer", async () => {
    const { svc, states } = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": rotating(T0 - 1) },
      now: () => T0,
      refreshToken: async () => ({
        ok: false,
        refusal: null,
        error: "timeout",
      }),
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBeNull();
    expect(states["T-SECOND"]).toBeUndefined();
  });
});

describe("slack install service — exchanging tokens that do not expire", () => {
  const T0 = 1_000_000_000_000;
  const HOUR = 60 * 60_000;

  function granting(minted: string[]): SlackTokenGrant {
    return async (token) => {
      minted.push(token);
      return {
        ok: true,
        accessToken: `xoxe.${token}`,
        refreshToken: `xoxe-1-${token}`,
        expiresAt: T0 + 12 * HOUR,
      };
    };
  }

  /**
   * TEST_SCENARIO: An imported Helm token is exchanged like any other row's.
   * Slack retires the Helm token as it answers, so the row is the only place
   * the credential survives.
   */
  it("exchanges an imported Helm token", async () => {
    const exchanged: string[] = [];
    const { svc, installs, stored } = service({
      now: () => T0,
      exchangeToken: granting(exchanged),
    });
    await svc.importHelmToken(ORIGINAL_TEAM, ENV_TOKEN);

    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBe(`xoxe.${ENV_TOKEN}`);
    expect(exchanged).toEqual([ENV_TOKEN]);
    expect(stored[installs[ORIGINAL_TEAM]!.secretPath]).toEqual({
      botToken: `xoxe.${ENV_TOKEN}`,
      refreshToken: `xoxe-1-${ENV_TOKEN}`,
      expiresAt: String(T0 + 12 * HOUR),
    });
  });

  /**
   * TEST_SCENARIO: A workspace connected before rotation was on holds a token
   * that does not expire; it is exchanged in place, keeping its row and
   * Secret, and is not mistaken for the operator's workspace.
   */
  it("exchanges a connected workspace's token in place", async () => {
    const exchanged: string[] = [];
    const { svc, installs, stored } = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": "xoxb-second" },
      now: () => T0,
      exchangeToken: granting(exchanged),
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBe("xoxe.xoxb-second");
    expect(installs["T-SECOND"]?.secretPath).toBe("secret-second");
    expect(stored["secret-second"]?.refreshToken).toBe("xoxe-1-xoxb-second");
  });

  /**
   * TEST_SCENARIO: Slack refusing the exchange — rotation not yet turned on in
   * the app, say — leaves the old token serving, and the next attempt waits
   * rather than asking Slack on every resolve.
   */
  it("keeps the old token when an exchange fails, and waits before retrying", async () => {
    let clock = T0;
    let attempts = 0;
    const { svc } = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": "xoxb-second" },
      now: () => clock,
      exchangeToken: async () => {
        attempts++;
        return {
          ok: false,
          refusal: "token_rotation_not_enabled",
          error: "token_rotation_not_enabled",
        };
      },
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBe("xoxb-second");
    clock += 2 * 60_000;
    expect(await svc.resolveBotToken("T-SECOND")).toBe("xoxb-second");
    expect(attempts).toBe(1);
    clock += 10 * 60_000;
    await svc.resolveBotToken("T-SECOND");
    expect(attempts).toBe(2);
  });

  /**
   * TEST_SCENARIO: With exchanging off, a token that does not expire is served
   * as it is, exactly as before rotation existed.
   */
  it("leaves tokens alone while exchanging is off", async () => {
    const { svc, stored } = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": "xoxb-second" },
      now: () => T0,
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBe("xoxb-second");
    expect(stored["secret-second"]).toEqual({ botToken: "xoxb-second" });
  });

  /**
   * TEST_SCENARIO: Exchanges happen when the gateway comes up, not on a
   * workspace's first message — every connected workspace, the imported
   * operator's one included, is exchanged by one sweep.
   */
  it("exchanges every workspace's token in one sweep", async () => {
    const exchanged: string[] = [];
    const { svc, installs } = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": "xoxb-second" },
      now: () => T0,
      exchangeToken: granting(exchanged),
    });
    await svc.importHelmToken(ORIGINAL_TEAM, ENV_TOKEN);

    const { renewAll } = svc;
    await renewAll();

    expect(exchanged.sort()).toEqual([ENV_TOKEN, "xoxb-second"].sort());
    expect(installs[ORIGINAL_TEAM]).toBeDefined();
  });
});

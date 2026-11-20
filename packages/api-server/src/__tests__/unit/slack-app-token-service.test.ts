import { describe, it, expect } from "vitest";
import {
  createSlackAppTokenService,
  SLACK_APP_TOKEN_SECRET_PATH,
} from "../../modules/channels/services/slack-app-token-service.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type {
  SlackTokenGrant,
  SlackTokenGrantResult,
} from "../../modules/channels/infrastructure/slack-token-rotation.js";

/**
 * TEST_OVERVIEW: Which app-level token opens the Slack Socket Mode
 * connection. The Helm value is imported once: with token rotation on it is
 * exchanged for a rotating pair kept in one install-wide Secret, and the pair
 * is renewed an hour after it was minted, under one lock, so two replicas
 * never spend the same refresh token. Without rotation and with nothing
 * stored, the Helm value is served as it is. A pair Slack refused after it
 * expired serves nothing until a new Helm value is set, which is imported
 * again.
 */

const HOUR = 60 * 60_000;
const HELM = "xapp-1-from-helm";

function mutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return async <T>(_key: string, run: () => Promise<T>): Promise<T> => {
    const result = tail.then(run);
    tail = result.catch(() => {});
    return result;
  };
}

function grant(
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): SlackTokenGrantResult {
  return { ok: true, accessToken, refreshToken, expiresAt };
}

function setup(opts?: {
  helmToken?: string;
  rotationOn?: boolean;
  exchange?: SlackTokenGrant;
  refresh?: SlackTokenGrant;
  stored?: Record<string, string>;
}) {
  let clock = 1_000_000;
  const secrets: Record<string, Record<string, string>> = {};
  if (opts?.stored) secrets[SLACK_APP_TOKEN_SECRET_PATH] = { ...opts.stored };
  const calls = { exchange: [] as string[], refresh: [] as string[] };
  const store = {
    storeId: "k8s",
    get: async ({ path }: { path: string }) =>
      secrets[path] ? { ...secrets[path] } : null,
    put: async ({ path }: { path: string }, fields: Record<string, string>) => {
      secrets[path] = { ...fields };
    },
    putFields: async (
      { path }: { path: string },
      fields: Record<string, string>,
    ) => {
      secrets[path] = { ...secrets[path], ...fields };
    },
  } as unknown as SecretStore;
  const deps = {
    helmToken: opts?.helmToken ?? HELM,
    secrets: store,
    lock: mutex(),
    rotation: {
      exchange: async (token: string) => {
        calls.exchange.push(token);
        return opts?.exchange
          ? opts.exchange(token)
          : grant("xoxe.xapp-1", "xoxe-1-r1", clock + 12 * HOUR);
      },
      refresh: async (token: string) => {
        calls.refresh.push(token);
        return opts?.refresh
          ? opts.refresh(token)
          : grant("xoxe.xapp-2", "xoxe-1-r2", clock + 12 * HOUR);
      },
      now: () => clock,
    },
    exchangeLongLivedToken: opts?.rotationOn ?? true,
  };
  return {
    svc: createSlackAppTokenService(deps),
    rebuild: (helmToken: string) =>
      createSlackAppTokenService({ ...deps, helmToken }),
    secret: () => secrets[SLACK_APP_TOKEN_SECRET_PATH],
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

async function exchanged() {
  const env = setup();
  await env.svc.resolveAppToken();
  return env;
}

describe("Slack app-level token", () => {
  /**
   * TEST_SCENARIO: An install without token rotation. The Helm value is the
   * token, as before rotation existed, and nothing is written.
   */
  it("serves the Helm token as it is when rotation is off", async () => {
    const env = setup({ rotationOn: false });

    expect(await env.svc.resolveAppToken()).toBe(HELM);
    expect(env.calls.exchange).toEqual([]);
    expect(env.secret()).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: Rotation is turned on. The Helm token is exchanged once
   * for a rotating pair, the pair is stored with the Helm value's
   * fingerprint, and from then on the stored token answers.
   */
  it("exchanges the Helm token once and serves the stored pair", async () => {
    const env = setup();

    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-1");
    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-1");

    expect(env.calls.exchange).toEqual([HELM]);
    expect(env.secret()).toMatchObject({
      appToken: "xoxe.xapp-1",
      refreshToken: "xoxe-1-r1",
      expiresAt: String(env.now() + 12 * HOUR),
    });
    expect(env.secret()?.["importedFrom"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(env.secret())).not.toContain(HELM);
  });

  /**
   * TEST_SCENARIO: A restart after the exchange. A new process reads the
   * stored pair and does not exchange the Helm token again, which Slack would
   * refuse.
   */
  it("keeps the stored pair across a restart", async () => {
    const env = await exchanged();

    expect(await env.rebuild(HELM).resolveAppToken()).toBe("xoxe.xapp-1");
    expect(env.calls.exchange).toEqual([HELM]);
  });

  /**
   * TEST_SCENARIO: Slack does not answer the exchange. The Helm token keeps
   * the socket up, and the exchange is tried again only after ten minutes.
   */
  it("serves the Helm token after a failed exchange and retries later", async () => {
    const env = setup({
      exchange: async () => ({
        ok: false,
        credentialDead: false,
        error: "ratelimited",
      }),
    });

    expect(await env.svc.resolveAppToken()).toBe(HELM);
    env.advance(5 * 60_000);
    expect(await env.svc.resolveAppToken()).toBe(HELM);
    expect(env.calls.exchange).toHaveLength(1);

    env.advance(6 * 60_000);
    await env.svc.resolveAppToken();
    expect(env.calls.exchange).toHaveLength(2);
    expect(env.secret()).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: Slack exchanged the token, but the Secret could not be
   * written. The Helm token still works until the first renewal, so it keeps
   * the socket up instead of the socket going down for a storage error.
   */
  it("serves the Helm token when the exchanged pair cannot be saved", async () => {
    const env = setup();
    const failing = createSlackAppTokenService({
      helmToken: HELM,
      secrets: {
        storeId: "k8s",
        get: async () => null,
        put: async () => {
          throw new Error("secrets is forbidden");
        },
      } as unknown as SecretStore,
      lock: mutex(),
      rotation: {
        exchange: async () => grant("xoxe.xapp-1", "xoxe-1-r1", 12 * HOUR),
        refresh: async () => {
          throw new Error("no refresh expected");
        },
        now: env.now,
      },
      exchangeLongLivedToken: true,
    });

    expect(await failing.resolveAppToken()).toBe(HELM);
  });

  /**
   * TEST_SCENARIO: The stored token is more than an hour old. It is renewed
   * with its refresh token, and the new pair replaces the old one, so the
   * spent refresh token is never offered to Slack again.
   */
  it("renews the token an hour after it was minted", async () => {
    const env = await exchanged();

    env.advance(30 * 60_000);
    await env.svc.renew();
    expect(env.calls.refresh).toEqual([]);

    env.advance(31 * 60_000);
    await env.svc.renew();
    expect(env.calls.refresh).toEqual(["xoxe-1-r1"]);
    expect(env.secret()).toMatchObject({
      appToken: "xoxe.xapp-2",
      refreshToken: "xoxe-1-r2",
    });
    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-2");
  });

  /**
   * TEST_SCENARIO: Two callers find the token due at the same moment, as two
   * replicas would. The lock lets one refresh; the other re-reads the Secret
   * inside the lock and takes the new token, so the single-use refresh token
   * is spent once.
   */
  it("spends a refresh token once when two callers renew together", async () => {
    const env = await exchanged();
    env.advance(2 * HOUR);
    const other = env.rebuild(HELM);

    const [a, b] = await Promise.all([
      env.svc.resolveAppToken(),
      other.resolveAppToken(),
    ]);

    expect(env.calls.refresh).toEqual(["xoxe-1-r1"]);
    expect([a, b]).toEqual(["xoxe.xapp-2", "xoxe.xapp-2"]);
  });

  /**
   * TEST_SCENARIO: A renewal fails while the token is still valid. The token
   * keeps serving, so a Slack outage costs nothing until it expires.
   */
  it("keeps a valid token when its renewal fails", async () => {
    const env = setup({
      refresh: async () => ({
        ok: false,
        credentialDead: false,
        error: "fetch failed",
      }),
    });
    await env.svc.resolveAppToken();
    env.advance(2 * HOUR);

    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-1");
    expect(env.secret()?.["refused"]).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: Renewals failed until the token expired, and Slack now
   * refuses the refresh token as dead. Nothing is served, the Secret is
   * marked refused, and Slack is not asked again with the same dead refresh
   * token.
   */
  it("serves nothing once Slack refuses an expired token's refresh", async () => {
    const env = setup({
      refresh: async () => ({
        ok: false,
        credentialDead: true,
        error: "invalid_refresh_token",
      }),
    });
    await env.svc.resolveAppToken();
    env.advance(13 * HOUR);

    expect(await env.svc.resolveAppToken()).toBeNull();
    expect(env.secret()?.["refused"]).toBe("true");
    expect(await env.svc.resolveAppToken()).toBeNull();
    expect(env.calls.refresh).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: The operator recovers a refused install by generating a
   * new app-level token in Slack and setting it in Helm values. The new value
   * is not the one the stored pair came from, so it is exchanged and replaces
   * the refused pair.
   */
  it("imports a new Helm token over a refused pair", async () => {
    const env = setup({
      stored: {
        appToken: "xoxe.xapp-dead",
        refreshToken: "xoxe-1-dead",
        expiresAt: "0",
        importedFrom: "0".repeat(64),
        refused: "true",
      },
    });

    expect(await env.rebuild("xapp-1-regenerated").resolveAppToken()).toBe(
      "xoxe.xapp-1",
    );
    expect(env.calls.exchange).toEqual(["xapp-1-regenerated"]);
    expect(env.secret()?.["refused"]).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: The rotation setting is turned off after the exchange.
   * Slack's switch is one-way and the Helm token is already retired, so the
   * stored pair keeps being renewed.
   */
  it("keeps renewing a stored pair with the rotation setting off", async () => {
    const env = await exchanged();
    const off = createSlackAppTokenService({
      helmToken: HELM,
      secrets: {
        storeId: "k8s",
        get: async () => ({ ...env.secret() }),
        putFields: async (_ref: unknown, fields: Record<string, string>) => {
          Object.assign(env.secret()!, fields);
        },
      } as unknown as SecretStore,
      lock: mutex(),
      rotation: {
        exchange: async () => {
          throw new Error("no exchange expected");
        },
        refresh: async () =>
          grant("xoxe.xapp-3", "xoxe-1-r3", env.now() + 14 * HOUR),
        now: () => env.now(),
      },
      exchangeLongLivedToken: false,
    });
    env.advance(2 * HOUR);

    expect(await off.resolveAppToken()).toBe("xoxe.xapp-3");
  });
});

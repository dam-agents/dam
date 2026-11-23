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
 * connection where app-level token rotation is on. The refresh token of a
 * newly generated app-level token, from Helm values, is imported once: it is
 * spent for a rotating pair kept in one install-wide Secret, and the pair is
 * renewed an hour after it was minted, under one lock, so two replicas never
 * spend the same refresh token. Until then, or with no refresh token set, the
 * long-lived Helm token serves, and Slack is never asked to exchange it. A
 * pair Slack refused after it expired serves nothing until a new refresh
 * token is set, which is imported.
 */

const HOUR = 60 * 60_000;
const HELM = "xapp-1-from-helm";
const HELM_REFRESH = "xoxe-1-from-helm";

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
  helmRefreshToken?: string | null;
  importGrant?: SlackTokenGrant;
  refresh?: SlackTokenGrant;
  stored?: Record<string, string>;
}) {
  let clock = 1_000_000;
  const secrets: Record<string, Record<string, string>> = {};
  if (opts?.stored) secrets[SLACK_APP_TOKEN_SECRET_PATH] = { ...opts.stored };
  const calls = {
    exchange: [] as string[],
    import: [] as string[],
    refresh: [] as string[],
  };
  const imports = new Set<string>();
  const storage = { down: false };
  const spent = new Set<string>();
  const spentRefreshTokens = {
    mark: async (fingerprint: string) => {
      spent.add(fingerprint);
    },
    isSpent: async (fingerprint: string) => spent.has(fingerprint),
  };
  const store = {
    storeId: "k8s",
    get: async ({ path }: { path: string }) =>
      secrets[path] ? { ...secrets[path] } : null,
    put: async ({ path }: { path: string }, fields: Record<string, string>) => {
      if (storage.down) throw new Error("secrets is forbidden");
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
    helmToken: HELM,
    helmRefreshToken:
      opts?.helmRefreshToken === undefined
        ? HELM_REFRESH
        : opts.helmRefreshToken,
    secrets: store,
    lock: mutex(),
    rotation: {
      exchange: async (token: string): Promise<SlackTokenGrantResult> => {
        calls.exchange.push(token);
        return { ok: false, credentialDead: true, error: "invalid_auth" };
      },
      refresh: async (token: string) => {
        if (imports.has(token)) {
          calls.import.push(token);
          return opts?.importGrant
            ? opts.importGrant(token)
            : grant("xoxe.xapp-1", "xoxe-1-r1", clock + 12 * HOUR);
        }
        calls.refresh.push(token);
        return opts?.refresh
          ? opts.refresh(token)
          : grant("xoxe.xapp-2", "xoxe-1-r2", clock + 12 * HOUR);
      },
      now: () => clock,
    },
    spentRefreshTokens,
  };
  if (deps.helmRefreshToken) imports.add(deps.helmRefreshToken);
  return {
    svc: createSlackAppTokenService(deps),
    rebuild: (helmRefreshToken: string | null = deps.helmRefreshToken) => {
      if (helmRefreshToken) imports.add(helmRefreshToken);
      return createSlackAppTokenService({ ...deps, helmRefreshToken });
    },
    secret: () => secrets[SLACK_APP_TOKEN_SECRET_PATH],
    storage,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

async function imported() {
  const env = setup();
  await env.svc.resolveAppToken();
  return env;
}

describe("Slack app-level token", () => {
  /**
   * TEST_SCENARIO: Rotation is turned on with the refresh token of a newly
   * generated app-level token in Helm values. The refresh token is spent once
   * for a rotating pair, the pair is stored with the Helm value's
   * fingerprint, and from then on the stored token answers. The long-lived
   * Helm token is never offered to `oauth.v2.exchange`, which Slack refuses
   * for app-level tokens.
   */
  it("imports the Helm refresh token once and serves the stored pair", async () => {
    const env = setup();

    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-1");
    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-1");

    expect(env.calls.import).toEqual([HELM_REFRESH]);
    expect(env.calls.exchange).toEqual([]);
    expect(env.secret()).toMatchObject({
      appToken: "xoxe.xapp-1",
      refreshToken: "xoxe-1-r1",
      expiresAt: String(env.now() + 12 * HOUR),
    });
    expect(env.secret()?.["importedFrom"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(env.secret())).not.toContain(HELM_REFRESH);
    expect(JSON.stringify(env.secret())).not.toContain(HELM);
  });

  /**
   * TEST_SCENARIO: Rotation is on but no refresh token is set. The
   * long-lived Helm token keeps serving, Slack is asked for nothing, and no
   * Secret is written, however long the install runs.
   */
  it("stays on the long-lived token when no refresh token is set", async () => {
    const env = setup({ helmRefreshToken: null });

    expect(await env.svc.resolveAppToken()).toBe(HELM);
    env.advance(2 * HOUR);
    await env.svc.renew();
    expect(await env.svc.resolveAppToken()).toBe(HELM);

    expect(env.calls).toEqual({ exchange: [], import: [], refresh: [] });
    expect(env.secret()).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A restart after the import. A new process reads the
   * stored pair and does not spend the Helm refresh token again, which Slack
   * would refuse.
   */
  it("keeps the stored pair across a restart", async () => {
    const env = await imported();

    expect(await env.rebuild().resolveAppToken()).toBe("xoxe.xapp-1");
    expect(env.calls.import).toEqual([HELM_REFRESH]);
  });

  /**
   * TEST_SCENARIO: The stored pair has been renewed since the import. A
   * restart with the same, now long spent, Helm refresh token still matches
   * the renewed pair, so the renewed pair serves and nothing is imported.
   */
  it("keeps a renewed pair matched to the Helm refresh token", async () => {
    const env = await imported();
    env.advance(2 * HOUR);
    await env.svc.renew();

    expect(await env.rebuild().resolveAppToken()).toBe("xoxe.xapp-2");
    expect(env.calls.import).toEqual([HELM_REFRESH]);
  });

  /**
   * TEST_SCENARIO: The refresh token is removed from Helm values after the
   * import. The stored pair no longer matches, so Socket Mode goes back to
   * the long-lived Helm token.
   */
  it("goes back to the long-lived token when the refresh token is removed", async () => {
    const env = await imported();

    expect(await env.rebuild(null).resolveAppToken()).toBe(HELM);
    expect(env.calls.import).toEqual([HELM_REFRESH]);
  });

  /**
   * TEST_SCENARIO: Slack refuses the import, as it does for a refresh token
   * that was already spent. The long-lived Helm token keeps the socket up,
   * and the import is tried again only after ten minutes.
   */
  it("serves the long-lived token after a failed import and retries later", async () => {
    const env = setup({
      importGrant: async () => ({
        ok: false,
        credentialDead: true,
        error: "invalid_refresh_token",
      }),
    });

    expect(await env.svc.resolveAppToken()).toBe(HELM);
    env.advance(5 * 60_000);
    expect(await env.svc.resolveAppToken()).toBe(HELM);
    expect(env.calls.import).toHaveLength(1);

    env.advance(6 * 60_000);
    await env.svc.resolveAppToken();
    expect(env.calls.import).toHaveLength(2);
    expect(env.secret()).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: Slack spent the Helm refresh token, but the Secret could
   * not be written. A refresh token works only once, so the pair is the only
   * one there will be: it is served, and the next call saves it instead of
   * importing again.
   */
  it("keeps an imported pair the Secret refused and saves it later", async () => {
    const env = setup();
    env.storage.down = true;

    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-1");
    expect(env.secret()).toBeUndefined();
    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-1");

    env.storage.down = false;
    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-1");
    expect(env.calls.import).toEqual([HELM_REFRESH]);
    expect(env.secret()).toMatchObject({
      appToken: "xoxe.xapp-1",
      refreshToken: "xoxe-1-r1",
    });
  });

  /**
   * TEST_SCENARIO: Slack renewed the token, but the Secret could not be
   * written. The old refresh token is spent, so it is never offered again:
   * the new token is served, the renewal is not repeated, and the new pair
   * is saved once the Secret takes writes again. Its refresh token then
   * makes the next renewal.
   */
  it("keeps a renewed pair the Secret refused and renews with it once saved", async () => {
    const env = await imported();
    env.advance(2 * HOUR);
    env.storage.down = true;

    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-2");
    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-2");
    expect(env.calls.refresh).toEqual(["xoxe-1-r1"]);
    expect(env.secret()?.["refreshToken"]).toBe("xoxe-1-r1");

    env.storage.down = false;
    await env.svc.renew();
    expect(env.secret()).toMatchObject({
      appToken: "xoxe.xapp-2",
      refreshToken: "xoxe-1-r2",
    });
    expect(env.calls.refresh).toEqual(["xoxe-1-r1"]);

    env.advance(2 * HOUR);
    await env.svc.renew();
    expect(env.calls.refresh).toEqual(["xoxe-1-r1", "xoxe-1-r2"]);
  });

  /**
   * TEST_SCENARIO: While one replica holds a renewed pair it could not save,
   * another replica renews and saves a newer pair. The kept pair is older, so
   * it is dropped rather than written over the newer one, and the Secret's
   * pair is served.
   */
  it("drops a kept pair once another replica saved a newer one", async () => {
    const env = await imported();
    env.advance(2 * HOUR);
    env.storage.down = true;
    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-2");

    env.storage.down = false;
    env.secret()!["appToken"] = "xoxe.xapp-other";
    env.secret()!["refreshToken"] = "xoxe-1-other";
    env.secret()!["expiresAt"] = String(env.now() + 12 * HOUR);

    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-other");
    expect(env.secret()?.["refreshToken"]).toBe("xoxe-1-other");
  });

  /**
   * TEST_SCENARIO: The stored token is more than an hour old. It is renewed
   * with its refresh token, and the new pair replaces the old one, so the
   * spent refresh token is never offered to Slack again.
   */
  it("renews the token an hour after it was minted", async () => {
    const env = await imported();

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
    const env = await imported();
    env.advance(2 * HOUR);
    const other = env.rebuild();

    const [a, b] = await Promise.all([
      env.svc.resolveAppToken(),
      other.resolveAppToken(),
    ]);

    expect(env.calls.refresh).toEqual(["xoxe-1-r1"]);
    expect([a, b]).toEqual(["xoxe.xapp-2", "xoxe.xapp-2"]);
  });

  /**
   * TEST_SCENARIO: One replica renewed the token but could not save the new
   * pair, so the Secret still holds the refresh token it spent. Another
   * replica finds that pair due. While the old token is still valid it
   * serves that token and leaves the spent refresh token alone; the replica
   * holding the new pair saves it once the Secret takes writes again.
   */
  it("keeps another replica off a refresh token spent but not yet saved", async () => {
    const env = await imported();
    env.advance(2 * HOUR);
    env.storage.down = true;
    expect(await env.svc.resolveAppToken()).toBe("xoxe.xapp-2");

    const other = env.rebuild();
    expect(await other.resolveAppToken()).toBe("xoxe.xapp-1");
    await other.renew();
    expect(env.calls.refresh).toEqual(["xoxe-1-r1"]);

    env.storage.down = false;
    await env.svc.renew();
    expect(env.secret()?.["refreshToken"]).toBe("xoxe-1-r2");
    expect(await other.resolveAppToken()).toBe("xoxe.xapp-2");
  });

  /**
   * TEST_SCENARIO: The replica holding the unsaved pair restarted, so no one
   * will save it, and the old token has now expired. The spent mark no longer
   * holds the other replica back: it tries the renewal, so Slack decides
   * whether the refresh token still works, and a refusal reaches the
   * operator as a refused Secret.
   */
  it("tries the renewal once the old token expired despite the spent mark", async () => {
    const env = await imported();
    env.advance(2 * HOUR);
    env.storage.down = true;
    await env.svc.resolveAppToken();
    env.storage.down = false;

    env.advance(11 * HOUR);
    await env.rebuild().renew();
    expect(env.calls.refresh).toEqual(["xoxe-1-r1", "xoxe-1-r1"]);
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
   * new app-level token in Slack and setting its refresh token in Helm
   * values. The new value is not the one the stored pair came from, so it is
   * imported and replaces the refused pair.
   */
  it("imports a new Helm refresh token over a refused pair", async () => {
    const env = setup({
      stored: {
        appToken: "xoxe.xapp-dead",
        refreshToken: "xoxe-1-dead",
        expiresAt: "0",
        importedFrom: "0".repeat(64),
        refused: "true",
      },
    });

    expect(await env.rebuild("xoxe-1-regenerated").resolveAppToken()).toBe(
      "xoxe.xapp-1",
    );
    expect(env.calls.import).toEqual(["xoxe-1-regenerated"]);
    expect(env.secret()?.["refused"]).toBeUndefined();
  });
});

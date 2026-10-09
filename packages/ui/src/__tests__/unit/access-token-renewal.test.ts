import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST_OVERVIEW: Every connection the UI opens takes its bearer from
 * getAccessToken. The tRPC WebSocket is nudged to reconnect 30 s before its
 * token expires, so a token handed out inside that window gets the new
 * connection nudged straight away. The getter must therefore renew a token
 * that is close to expiry rather than reuse it. The silent-renew timer
 * normally does this first, but a background tab throttles that timer. A
 * failed renewal must not send the user to the login page while the old
 * token still works.
 */

const oidc = vi.hoisted(() => ({
  user: null as { access_token: string; expires_in?: number } | null,
  signinSilent: vi.fn(),
  signinRedirect: vi.fn(),
}));

vi.mock("oidc-client-ts", () => ({
  UserManager: class {
    getUser = async () =>
      oidc.user && { ...oidc.user, expired: (oidc.user.expires_in ?? 1) <= 0 };
    signinSilent = oidc.signinSilent;
    signinRedirect = oidc.signinRedirect;
  },
  WebStorageStateStore: class {},
}));
vi.mock("../../lib/return-path.js", () => ({
  rememberReturnPath: () => {},
  takeReturnPath: () => "/",
}));
vi.mock("../../modules/platform/store/theme.js", () => ({
  readStoredTheme: () => "light",
}));
vi.mock("../../modules/sessions/lib/draft-snapshot.js", () => ({
  draftWriter: {},
}));
vi.mock("../../modules/sessions/lib/undelivered-store.js", () => ({
  removeAllUndelivered: () => {},
}));

async function signedIn(user: { access_token: string; expires_in?: number }) {
  oidc.user = user;
  vi.resetModules();
  const auth = await import("../../auth.js");
  await auth.initAuth();
  return auth;
}

beforeEach(() => {
  vi.stubGlobal("window", {
    location: { pathname: "/", origin: "http://ui.test" },
    history: { replaceState: () => {} },
  });
  vi.stubGlobal("sessionStorage", {});
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          issuer: "http://idp.test/realms/r",
          clientId: "ui",
          cliClientId: "cli",
        }),
      ),
  );
  oidc.signinSilent.mockReset();
  oidc.signinRedirect.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("getAccessToken", () => {
  // TEST_SCENARIO: The token has 20 s left, inside the server's nudge lead. The getter renews and returns the new token.
  it("renews a token that is about to expire", async () => {
    const auth = await signedIn({ access_token: "old", expires_in: 20 });
    oidc.signinSilent.mockResolvedValue({ access_token: "new" });
    expect(await auth.getAccessToken()).toBe("new");
  });

  // TEST_SCENARIO: The token has minutes left. The getter returns it without a renewal round trip.
  it("reuses a token with time left", async () => {
    const auth = await signedIn({ access_token: "old", expires_in: 240 });
    expect(await auth.getAccessToken()).toBe("old");
    expect(oidc.signinSilent).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: Several connections ask for a token at once inside the window. They share one renewal rather than each starting a silent sign-in.
  it("shares one renewal between concurrent callers", async () => {
    const auth = await signedIn({ access_token: "old", expires_in: 20 });
    oidc.signinSilent.mockResolvedValue({ access_token: "new" });
    const tokens = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);
    expect(tokens).toEqual(["new", "new", "new"]);
    expect(oidc.signinSilent).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: The renewal fails while the old token is still valid. The getter keeps the user on the page with the old token.
  it("falls back to a still-valid token when renewal fails", async () => {
    const auth = await signedIn({ access_token: "old", expires_in: 20 });
    oidc.signinSilent.mockRejectedValue(new Error("iframe timeout"));
    expect(await auth.getAccessToken()).toBe("old");
    expect(oidc.signinRedirect).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: The token has expired and the renewal fails. The getter sends the user to sign in again.
  it("redirects to sign-in when an expired token cannot be renewed", async () => {
    const auth = await signedIn({ access_token: "old", expires_in: 20 });
    oidc.user = { access_token: "old", expires_in: 0 };
    oidc.signinSilent.mockRejectedValue(new Error("login_required"));
    await expect(auth.getAccessToken()).rejects.toThrow("Session expired");
    expect(oidc.signinRedirect).toHaveBeenCalled();
  });
});

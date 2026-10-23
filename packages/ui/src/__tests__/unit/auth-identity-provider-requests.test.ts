import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as auth from "../../auth.js";

/**
 * TEST_OVERVIEW: The UI's own calls to its identity provider (the discovery
 * document, the code exchange, token renewal) carry the browser's cookies for
 * the identity provider's origin. An identity provider behind a gate that
 * admits a visitor by a session cookie, such as an Environment endpoint,
 * answers them only with that cookie; one that needs none, as on the
 * platform's own cluster, allows them already.
 */

const settings = vi.hoisted(() => ({ seen: [] as Record<string, unknown>[] }));

vi.mock("oidc-client-ts", () => ({
  UserManager: class {
    constructor(s: Record<string, unknown>) {
      settings.seen.push(s);
    }
    getUser = async () => null;
    signinRedirect = vi.fn();
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

beforeEach(() => {
  settings.seen = [];
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
});

afterEach(() => vi.unstubAllGlobals());

describe("the UI's requests to its identity provider", () => {
  // TEST_SCENARIO: the sign-in client is set up to send the browser's cookies with every request it makes to the identity provider itself.
  it("send the browser's cookies for the identity provider", async () => {
    await auth.initAuth();
    expect(settings.seen[settings.seen.length - 1]).toMatchObject({
      authority: "http://idp.test/realms/r",
      fetchRequestCredentials: "include",
    });
  });
});

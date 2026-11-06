import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createOAuthRoutes } from "../../modules/connections/oauth-routes.js";
import type { OAuthCallbackDeps } from "../../modules/connections/oauth-routes.js";
import type { OAuthEngine } from "../../modules/connections/infrastructure/oauth-engine.js";
import { unused } from "../helpers/connections-service.js";

/**
 * TEST_OVERVIEW: the OAuth callback page of a popup sign-in hands its result
 * to the app on two channels: postMessage to window.opener, and a
 * BroadcastChannel named "platform-oauth" on the app's origin. An
 * authorization server that sends Cross-Origin-Opener-Policy: same-origin
 * leaves the callback page with no opener, so the broadcast is the one that
 * arrives. The result names the connection, so a tab takes only its own.
 */

const UI = "https://platform.example.com";

function app(popup: boolean) {
  const engine = unused<OAuthEngine>({
    peek: (async () => ({
      ctx: { connectionId: "conn-1", ownerId: "owner-1", popup },
    })) as OAuthEngine["peek"],
  });
  const routes = createOAuthRoutes(
    unused<OAuthCallbackDeps>({ uiBaseUrl: UI, brandName: "Test", engine }),
  );
  return new Hono().route("/api/oauth", routes);
}

describe("OAuth popup callback page", () => {
  // TEST_SCENARIO: the provider answers with an error; the popup page broadcasts it with the connection it belongs to, beside the postMessage to the opener.
  it("broadcasts the result with its connection", async () => {
    const res = await app(true).request(
      "/api/oauth/callback?error=access_denied&state=s1",
    );
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('new BroadcastChannel("platform-oauth")');
    expect(html).toContain("window.opener.postMessage(result,");
    expect(html).toContain(
      '{"source":"platform-oauth","oauth":"error","message":"access_denied","connection":"conn-1"}',
    );
  });

  // TEST_SCENARIO: a full-page sign-in has no popup to answer; it still redirects back to the app.
  it("redirects a full-page sign-in", async () => {
    const res = await app(false).request(
      "/api/oauth/callback?error=access_denied&state=s1",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("oauth=error");
  });
});

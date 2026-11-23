import { describe, it, expect } from "vitest";
import { fetchWithCurrentAppToken } from "../../modules/channels/infrastructure/slack-app-token-fetch.js";

/**
 * TEST_OVERVIEW: The Socket Mode client's requests carry the app-level token
 * the resolver gives at the time of each request, not the one the client was
 * built with. A resolver that fails reuses the token it gave last, and no
 * token at all is answered with Slack's own `not_authed` refusal without
 * calling Slack.
 */

function recorder() {
  const sent: (string | undefined)[] = [];
  const fetchImpl = async (
    _url: string | URL,
    init?: { headers?: Record<string, string> },
  ) => {
    sent.push(init?.headers?.["Authorization"]);
    return new Response(JSON.stringify({ ok: true }));
  };
  return { sent, fetchImpl };
}

describe("Socket Mode requests and the app-level token", () => {
  /**
   * TEST_SCENARIO: The token is renewed between two requests. Each request
   * carries the token current when it is sent, in place of the client's own.
   */
  it("signs every request with the token current at that time", async () => {
    const { sent, fetchImpl } = recorder();
    let token = "xoxe.xapp-1";
    const fetch = fetchWithCurrentAppToken(async () => token, fetchImpl);

    await fetch("https://slack.com/api/apps.connections.open", {
      headers: { Authorization: "Bearer built-in" },
    });
    token = "xoxe.xapp-2";
    await fetch("https://slack.com/api/apps.connections.open", {
      headers: { Authorization: "Bearer built-in" },
    });

    expect(sent).toEqual(["Bearer xoxe.xapp-1", "Bearer xoxe.xapp-2"]);
  });

  /**
   * TEST_SCENARIO: The Secret cannot be read for a moment. The token the
   * resolver gave last was valid then, so the reconnect uses it rather than
   * keeping the socket down for a storage error.
   */
  it("reuses the last token when the resolver fails", async () => {
    const { sent, fetchImpl } = recorder();
    let fail = false;
    const fetch = fetchWithCurrentAppToken(async () => {
      if (fail) throw new Error("connect ECONNREFUSED");
      return "xoxe.xapp-1";
    }, fetchImpl);

    await fetch("https://slack.com/api/apps.connections.open");
    fail = true;
    await fetch("https://slack.com/api/apps.connections.open");

    expect(sent).toEqual(["Bearer xoxe.xapp-1", "Bearer xoxe.xapp-1"]);
  });

  /**
   * TEST_SCENARIO: There is no token, as after Slack refused an expired
   * token's refresh. Slack is not called, and the answer is the refusal the
   * Socket Mode client stops on at once.
   */
  it("answers not_authed without calling Slack when there is no token", async () => {
    const { sent, fetchImpl } = recorder();
    const fetch = fetchWithCurrentAppToken(async () => null, fetchImpl);

    const response = await fetch("https://slack.com/api/apps.connections.open");

    expect(sent).toEqual([]);
    expect(await response.json()).toEqual({ ok: false, error: "not_authed" });
  });
});

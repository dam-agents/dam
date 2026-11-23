import { describe, it, expect } from "vitest";
import { slackAppTokenSource } from "../../modules/channels/services/slack-app-token-source.js";

/**
 * TEST_OVERVIEW: The install's app-level token rotation switch decides where
 * the Slack Socket Mode connection gets its token. Off, the Helm value is the
 * token and nothing that rotates is built, so no Secret, exchange or renewal
 * exists. On, the rotating service answers every connect and renews in the
 * periodic sweep.
 */

describe("Slack app-level token source", () => {
  /**
   * TEST_SCENARIO: An install with bot token rotation on but app-level
   * rotation off, as production runs until someone turns the new switch on.
   * The socket gets the plain Helm token, the rotating service is never
   * built, and the periodic sweep has no app-level token to renew.
   */
  it("serves the plain Helm token and builds nothing when rotation is off", () => {
    let built = 0;
    const { source, renew } = slackAppTokenSource({
      helmToken: "xapp-1-from-helm",
      rotation: false,
      createRotating: () => {
        built += 1;
        return { resolveAppToken: async () => null, renew: async () => {} };
      },
    });

    expect(source).toEqual({ kind: "static", token: "xapp-1-from-helm" });
    expect(renew).toBeNull();
    expect(built).toBe(0);
  });

  /**
   * TEST_SCENARIO: App-level rotation is on. The socket asks the rotating
   * service for the token on each connect, and the sweep renews through it.
   */
  it("asks the rotating service when rotation is on", async () => {
    let renewed = 0;
    const { source, renew } = slackAppTokenSource({
      helmToken: "xapp-1-from-helm",
      rotation: true,
      createRotating: () => ({
        resolveAppToken: async () => "xoxe.xapp-1",
        renew: async () => {
          renewed += 1;
        },
      }),
    });

    expect(source.kind).toBe("rotating");
    if (source.kind !== "rotating") return;
    expect(await source.resolve()).toBe("xoxe.xapp-1");
    await renew?.();
    expect(renewed).toBe(1);
  });
});

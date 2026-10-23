import { describe, expect, it } from "vitest";

import { routeExtNotification } from "../../modules/acp/ext-notifications.js";

/**
 * TEST_OVERVIEW: platform extension notifications route to the update handler
 * with their replay attribution intact.
 *
 * The runtime stamps every frame it replays for a load — including
 * `platform/turnEnded`, which lives in the transcript — with
 * `_meta.platform.replayFor`. The client's collector admits a frame into the
 * replayed history only when that token matches its own, so a routing layer
 * that drops the token silently diverts replayed frames into the live view:
 * history loses its turn boundaries and a streaming live turn can be closed
 * by a frame from the past. Every extension route must therefore surface the
 * token exactly as the `session/update` route does — and frames without a
 * stamp must surface none, so live frames keep failing the collector's gate.
 */

describe("routeExtNotification", () => {
  /**
   * TEST_SCENARIO: A replayed turnEnded carries the stamp of the load that
   * asked for it; the routed update must surface that token so the collector
   * can claim the frame for the replay instead of leaking it to the live
   * projection.
   */
  it("should surface replayFor from a stamped turnEnded", () => {
    const routed = routeExtNotification("platform/turnEnded", {
      sessionId: "sess-1",
      _meta: { platform: { replayFor: "load-token-7" } },
    });
    expect(routed).toEqual({
      update: { sessionUpdate: "platform_turn_ended", sessionId: "sess-1" },
      sessionId: "sess-1",
      replayFor: "load-token-7",
    });
  });

  /**
   * TEST_SCENARIO: A live turnEnded carries no stamp; the routed update must
   * surface no token, so it fails the collector's gate and reaches the live
   * projection.
   */
  it("should surface no replayFor for an unstamped notification", () => {
    const routed = routeExtNotification("platform/turnEnded", {
      sessionId: "sess-1",
    });
    expect(routed).toEqual({
      update: { sessionUpdate: "platform_turn_ended", sessionId: "sess-1" },
      sessionId: "sess-1",
      replayFor: undefined,
    });
  });

  /**
   * TEST_SCENARIO: The prompt-fate notifications route with the same shape —
   * they are never replayed today, but the routing must not be the layer
   * that decides that.
   */
  it("should route prompt-fate notifications with attribution intact", () => {
    const accepted = routeExtNotification("platform/promptAccepted", {
      sessionId: "sess-1",
      promptId: "p-1",
      queued: true,
      _meta: { platform: { replayFor: "load-token-7" } },
    });
    expect(accepted?.update).toEqual({
      sessionUpdate: "platform_prompt_accepted",
      sessionId: "sess-1",
      promptId: "p-1",
      queued: true,
    });
    expect(accepted?.replayFor).toBe("load-token-7");

    const started = routeExtNotification("platform/promptStarted", {
      sessionId: "sess-1",
      promptId: "p-1",
    });
    expect(started?.update).toEqual({
      sessionUpdate: "platform_prompt_started",
      sessionId: "sess-1",
      promptId: "p-1",
    });
  });

  /**
   * TEST_SCENARIO: Unknown methods and malformed params route nowhere — the
   * handler must never see a half-parsed update.
   */
  it("should route nothing for unknown methods or malformed params", () => {
    expect(routeExtNotification("platform/unknown", { sessionId: "s" })).toBe(
      null,
    );
    expect(routeExtNotification("platform/turnEnded", {})).toBe(null);
  });
});

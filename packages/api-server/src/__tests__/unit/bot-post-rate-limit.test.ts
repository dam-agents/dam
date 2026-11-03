/**
 * TEST_OVERVIEW: The bot-post rate limit admits at most a fixed number of bot
 * posts per conversation in a sliding window. The first post over the limit
 * trips a pause, the posts during the pause are dropped, and after it the
 * window starts empty. Each conversation is counted on its own.
 */
import { describe, expect, it } from "vitest";
import { createBotPostRateLimit } from "../../modules/channels/domain/bot-post-rate-limit.js";

function clocked(opts: {
  limit: number;
  windowMs: number;
  cooldownMs: number;
}) {
  let now = 0;
  const limit = createBotPostRateLimit({ ...opts, now: () => now });
  return {
    admit: (conversation = "c") => limit.admitBotPost(conversation),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createBotPostRateLimit", () => {
  it("admits bot posts up to the limit, then trips once and pauses", () => {
    const rate = clocked({ limit: 2, windowMs: 1000, cooldownMs: 5000 });
    expect(rate.admit()).toBe("admitted");
    expect(rate.admit()).toBe("admitted");
    expect(rate.admit()).toBe("tripped");
    expect(rate.admit()).toBe("paused");
  });

  /** TEST_SCENARIO: Posts spread out slower than the limit never trip it,
   *  however many there are: a long discussion between Agents goes on. */
  it("keeps admitting posts that arrive slower than the limit", () => {
    const rate = clocked({ limit: 2, windowMs: 1000, cooldownMs: 5000 });
    for (let i = 0; i < 20; i++) {
      expect(rate.admit()).toBe("admitted");
      rate.advance(600);
    }
  });

  it("counts only the posts inside the window", () => {
    const rate = clocked({ limit: 2, windowMs: 1000, cooldownMs: 5000 });
    expect(rate.admit()).toBe("admitted");
    rate.advance(500);
    expect(rate.admit()).toBe("admitted");
    rate.advance(501);
    expect(rate.admit()).toBe("admitted");
    expect(rate.admit()).toBe("tripped");
  });

  /** TEST_SCENARIO: Once the pause ends, bot posts start turns again and
   *  the posts before the pause no longer count. */
  it("admits again after the pause, with an empty window", () => {
    const rate = clocked({ limit: 2, windowMs: 1000, cooldownMs: 5000 });
    rate.admit();
    rate.admit();
    expect(rate.admit()).toBe("tripped");
    rate.advance(4999);
    expect(rate.admit()).toBe("paused");
    rate.advance(1);
    expect(rate.admit()).toBe("admitted");
    expect(rate.admit()).toBe("admitted");
    expect(rate.admit()).toBe("tripped");
  });

  it("counts each conversation on its own", () => {
    const rate = clocked({ limit: 1, windowMs: 1000, cooldownMs: 5000 });
    expect(rate.admit("c1")).toBe("admitted");
    expect(rate.admit("c1")).toBe("tripped");
    expect(rate.admit("c2")).toBe("admitted");
  });
});

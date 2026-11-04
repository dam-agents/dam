// TEST_OVERVIEW: the notice a Slack channel row shows after the loop guard dropped bot or app posts there. It names the count, the time of the last drop, the guard's limit, window and pause as the server sends them, and the newest drops with their sender and place.
import type { SlackLoopGuardDrops } from "api-server-api";
import { describe, expect, it } from "vitest";

import { loopGuardNoticeCopy } from "../../modules/sandboxes/lib/slack-loop-guard.js";

const NOW = new Date(2026, 9, 22, 18, 0);
const at = (day: number, hour: number) =>
  new Date(2026, 9, day, hour, 0).toISOString();

function drops(
  overrides: Partial<SlackLoopGuardDrops> = {},
): SlackLoopGuardDrops {
  return {
    limit: 10,
    windowMs: 60_000,
    cooldownMs: 300_000,
    dropped: 1,
    lastDroppedAt: at(22, 17),
    recent: [],
    ...overrides,
  };
}

describe("the loop guard notice", () => {
  // TEST_SCENARIO: one drop today reads in the singular with the time alone, and the rule names the limit, window and pause the server sent.
  it("names one drop today and the server's rate limit", () => {
    const copy = loopGuardNoticeCopy(
      drops({ limit: 5, windowMs: 120_000, cooldownMs: 60_000 }),
      NOW,
    );
    expect(copy.title).toMatch(
      /^1 bot or app post dropped by the loop guard, last [^,]*\.$/,
    );
    expect(copy.rule).toContain(
      "When more than 5 bot or app posts reach one conversation within 2 minutes",
    );
    expect(copy.rule).toContain("start no turn for a minute");
    expect(copy.latest).toBeNull();
  });

  // TEST_SCENARIO: drops from yesterday carry their date, and each recent drop names its sender kind and whether it was in a thread.
  it("dates an earlier drop and lists the recent ones", () => {
    const copy = loopGuardNoticeCopy(
      drops({
        dropped: 4,
        lastDroppedAt: at(21, 23),
        recent: [
          { at: at(21, 23), thread: true, sender: "app", name: "FluxCD" },
          { at: at(21, 22), thread: false, sender: "agent", name: "Alpha" },
        ],
      }),
      NOW,
    );
    expect(copy.title).toMatch(
      /^4 bot or app posts dropped by the loop guard, last Oct 21, /,
    );
    expect(copy.latest).toMatch(
      /^FluxCD \(app, in a thread, Oct 21, .*\); Alpha \(agent, top level, Oct 21, .*\)$/,
    );
  });
});

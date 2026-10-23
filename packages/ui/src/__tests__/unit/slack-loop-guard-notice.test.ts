// TEST_OVERVIEW: the notice a Slack channel row shows after the loop guard dropped bot or app posts there. It names the count, the time of the last drop, the guard's limit as the server sends it, and the newest drops with their sender and place.
import type { SlackLoopGuardDrops } from "api-server-api";
import { describe, expect, it } from "vitest";

import { clockLabel, formatDate } from "../../lib/format-time.js";
import { loopGuardNoticeCopy } from "../../modules/sandboxes/lib/slack-loop-guard.js";

const NOW = new Date(2026, 9, 22, 18, 0);
const at = (day: number, hour: number) =>
  new Date(2026, 9, day, hour, 0).toISOString();
const dated = (iso: string) =>
  `${formatDate(iso, { month: "short", day: "numeric" })}, ${clockLabel(iso)}`;

function drops(
  overrides: Partial<SlackLoopGuardDrops> = {},
): SlackLoopGuardDrops {
  return {
    limit: 3,
    dropped: 1,
    lastDroppedAt: at(22, 17),
    recent: [],
    ...overrides,
  };
}

describe("the loop guard notice", () => {
  // TEST_SCENARIO: one drop today reads in the singular with the time alone, and the rule names the limit the server sent.
  it("names one drop today and the server's limit", () => {
    const copy = loopGuardNoticeCopy(drops({ limit: 5 }), NOW);
    expect(copy.title).toBe(
      `1 bot or app post dropped by the loop guard, last ${clockLabel(at(22, 17))}.`,
    );
    expect(copy.rule).toContain("Once 5 bot or app posts in a row");
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
    expect(copy.title).toBe(
      `4 bot or app posts dropped by the loop guard, last ${dated(at(21, 23))}.`,
    );
    expect(copy.latest).toBe(
      `FluxCD (app, in a thread, ${dated(at(21, 23))}); Alpha (agent, top level, ${dated(at(21, 22))})`,
    );
  });
});

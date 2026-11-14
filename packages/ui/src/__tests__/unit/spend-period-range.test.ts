import { describe, expect, it } from "vitest";

import {
  HOME_PERIODS,
  rangeOfPeriods,
} from "../../modules/spend/lib/spend-period.js";

/**
 * TEST_OVERVIEW: the range that holds every period a place offers, so a figure
 * asked of all of them at once is read once instead of once per tab.
 */

describe("the range of several periods", () => {
  // TEST_SCENARIO: Home's three tabs overlap — today is inside this month — so one range holds them all: from last month's first day to this month's last.
  it("spans Home's tabs from the earliest start to the latest end", () => {
    expect(rangeOfPeriods(HOME_PERIODS, "2026-11-14")).toEqual({
      from: "2026-10-01",
      to: "2026-11-30",
    });
  });

  it("is the period itself when there is one", () => {
    expect(rangeOfPeriods(["last-week"], "2026-11-14")).toEqual({
      from: "2026-11-02",
      to: "2026-11-08",
    });
  });
});

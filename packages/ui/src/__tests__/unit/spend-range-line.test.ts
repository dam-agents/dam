import { describe, expect, it } from "vitest";

import { rangeLine } from "../../modules/spend/lib/copy.js";

/**
 * TEST_OVERVIEW: the line under a spend total. A range that is still running
 * names only its start, so it never shows today's UTC day, which reads as
 * tomorrow in the evening west of UTC. A finished range keeps its full dates.
 */

describe("the spend range line", () => {
  // TEST_SCENARIO: this month, measured from 4 Nov, read on 19 Nov (UTC): the line says where it starts and nothing about the end.
  it("names only the start of a range that is still running", () => {
    expect(rangeLine({ from: "2026-11-04", to: "2026-11-19" }, true)).toBe(
      "Since 4 Nov",
    );
  });

  // TEST_SCENARIO: the Today tab is one running day, so it reads "Today so far" instead of a date.
  it("reads Today so far for today alone", () => {
    expect(rangeLine({ from: "2026-11-19", to: "2026-11-19" }, true)).toBe(
      "Today so far",
    );
  });

  // TEST_SCENARIO: a running range that began last year, such as this week across New Year, shows the start's year so it can't be read as this year.
  it("shows the year when the range began in an earlier one", () => {
    expect(rangeLine({ from: "2026-12-28", to: "2027-01-02" }, true)).toBe(
      "Since 28 Dec 2026",
    );
  });

  it("keeps the full dates of a finished range", () => {
    expect(rangeLine({ from: "2026-11-09", to: "2026-11-15" }, false)).toBe(
      "9–15 Nov 2026",
    );
  });
});

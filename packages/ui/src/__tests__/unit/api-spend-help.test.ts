import { describe, expect, it } from "vitest";

import { getBrand } from "../../brand.js";
import { apiSpendHelp } from "../../modules/spend/lib/copy.js";

/**
 * TEST_OVERVIEW: the API spend card's help text. Users asked whether the
 * figure is a charge from the platform, so the text answers that first, then
 * says what the figure counts and when a day starts.
 */

describe("the API spend help text", () => {
  // TEST_SCENARIO: a user opens the (i) on Home's API spend card: it says the platform doesn't charge them, what the figure counts, that it is an estimate, and when the day starts in their time.
  it("says the platform doesn't charge, what it counts and when days start", () => {
    const brand = getBrand().name;
    expect(apiSpendHelp("7:00 PM")).toBe(
      `Not charged by ${brand}. Your agents' model calls on paid API keys, at provider prices. ${brand}'s estimate. Days start at 7:00 PM your time.`,
    );
  });
});

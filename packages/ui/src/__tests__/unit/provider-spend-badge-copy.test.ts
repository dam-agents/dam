// TEST_OVERVIEW: A provider row's spend badge reads what it spent today of its daily limit, writes a Bobcoin amount with the unit's short form, and says in its tooltip when a subscription's amount is only there for comparison.
import { expect, it } from "vitest";

import { badgeSpend, badgeSpendTip } from "../../modules/spend/lib/copy.js";

// TEST_SCENARIO: dollars read as an amount of the limit, or as today's spend alone when no limit is set.
it("writes the spend of the limit, or the spend alone", () => {
  expect(badgeSpend(1_230_000, 4_560_000, "usd")).toBe("$1.23 / $4.56 today");
  expect(badgeSpend(0, null, "usd")).toBe("$0.00 today");
});

// TEST_SCENARIO: a subscription's worth is an amount of money too, so it reads the same way.
it("writes a subscription's worth as dollars", () => {
  expect(badgeSpend(1_230_000, 4_560_000, "usd_list")).toBe(
    "$1.23 / $4.56 today",
  );
});

// TEST_SCENARIO: Bobcoins are written with their short unit, not their name.
it("writes Bobcoins with their short unit", () => {
  expect(badgeSpend(250_000, 5_000_000, "bobcoin")).toBe(
    "0.25 Bc / 5.00 Bc today",
  );
  expect(badgeSpend(250_000, null, "bobcoin")).toBe("0.25 Bc today");
});

// TEST_SCENARIO: the tooltip says a subscription's amount is for comparison, and otherwise asks for the limit.
it("explains what the amount means", () => {
  expect(badgeSpendTip("usd_list", true)).toContain("comparison only");
  expect(badgeSpendTip("usd", true)).toContain("Click to change it");
  expect(badgeSpendTip("usd", false)).toContain("Click to set a daily limit");
  expect(badgeSpendTip("bobcoin", false)).toContain("Bobcoins");
});

// TEST_OVERVIEW: The spend-limit line reads "Spent $X today of $Y daily limit for <subject>." in the limit's unit, and shows ∞ when no limit is set.
import { describe, expect, test } from "vitest";

import { spendLimitSentence } from "../../modules/spend/lib/format.js";

const text = (parts: string[]) => parts.join("");

describe("spendLimitSentence", () => {
  test("a dollar limit names the agent and the provider", () => {
    expect(
      text(
        spendLimitSentence(1_250_000, 10_000_000, "usd", "Ada on Anthropic"),
      ),
    ).toBe("Spent $1.25 today of $10.00 daily limit for Ada on Anthropic.");
  });

  test("no limit reads as ∞", () => {
    const [, amount] = spendLimitSentence(0, null, "usd", "all your agents");
    expect(amount).toBe("∞");
  });

  test("Bobcoins and subscription value keep their unit", () => {
    expect(
      text(spendLimitSentence(500_000, 2_000_000, "bobcoin", "Ada on Bob")),
    ).toBe("Spent 0.50 Bobcoins today of 2.00 daily limit for Ada on Bob.");
    expect(text(spendLimitSentence(0, null, "usd_list", "Ada on Claude"))).toBe(
      "Spent $0.00 subscription value today of ∞ daily limit for Ada on Claude.",
    );
  });
});

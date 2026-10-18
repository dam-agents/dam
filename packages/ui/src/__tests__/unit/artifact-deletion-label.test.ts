// TEST_OVERVIEW: an artifact's deletion chip counts the time left up, not down, so choosing "Delete in 7 days" reads 7d at once instead of 6d.
import { describe, expect, test } from "vitest";

import { remainingUnit } from "../../modules/artifacts/lib/format.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("remainingUnit", () => {
  // TEST_SCENARIO: the chip right after a 7-day expiration is set, a moment under seven days left, reads 7d; a day and a minute reads 2d, so the chip never claims less time than is left.
  test("rounds the largest unit up", () => {
    expect(remainingUnit(7 * DAY - 1000)).toBe("7d");
    expect(remainingUnit(DAY + MINUTE)).toBe("2d");
    expect(remainingUnit(DAY)).toBe("1d");
    expect(remainingUnit(90 * MINUTE)).toBe("2h");
    expect(remainingUnit(5 * MINUTE)).toBe("5m");
    expect(remainingUnit(10_000)).toBe("1m");
  });
});

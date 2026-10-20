import { describe, expect, it } from "vitest";

import { stripTravel } from "../../modules/platform/lib/agent-strip.js";

/**
 * TEST_OVERVIEW: The new layout's agent strip has two fixed widths. A short drag of its edge toward the other width flips it at once; a drag away from that width does not count toward the flip.
 */

describe("agent strip width", () => {
  it("TEST_SCENARIO: a narrow strip flips wide after a short drag right, not before", () => {
    const first = stripTravel(0, 8, false);
    expect(first.flip).toBe(false);
    expect(stripTravel(first.travel, 8, false).flip).toBe(true);
  });

  it("TEST_SCENARIO: a wide strip ignores a drag right, so a drag back left flips it after the same short travel", () => {
    const away = stripTravel(0, 40, true);
    expect(away).toEqual({ travel: 0, flip: false });
    expect(stripTravel(away.travel, -12, true).flip).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { segmentFill } from "../../modules/budgets/lib/pool-colors.js";

/**
 * TEST_OVERVIEW: A pool bar shows its level on every segment, so a bar whose
 * use is mostly caches and system is still coloured at warning and critical.
 */

describe("segmentFill", () => {
  // TEST_SCENARIO: at ok the rest of the bar stays a neutral tint of the foreground colour.
  it("keeps the rest neutral at ok", () => {
    expect(segmentFill("ok", false)).toContain("foreground");
    expect(segmentFill("ok", false)).not.toContain("amber");
  });

  // TEST_SCENARIO: at warning and critical the rest takes a tint of the level colour, distinct from an agent's own share.
  it.each([
    ["warning", "amber"],
    ["critical", "red"],
  ] as const)("tints the rest at %s", (level, hue) => {
    expect(segmentFill(level, false)).toContain(hue);
    expect(segmentFill(level, true)).toContain(hue);
    expect(segmentFill(level, false)).not.toBe(segmentFill(level, true));
  });
});

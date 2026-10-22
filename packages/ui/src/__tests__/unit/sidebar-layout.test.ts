import { describe, expect, it } from "vitest";

import {
  clampSidebarWidth,
  dragSidebarWidth,
} from "../../modules/platform/lib/sidebar-layout.js";

/**
 * TEST_OVERVIEW: The user drags the global sidebar wider or narrower, and the
 * width persists in browser storage. A drag must never make the sidebar
 * unusably narrow or wide, and the edge must stay under the pointer, also
 * after the pointer went past a bound and came back.
 */

function drag(start: number, deltas: readonly number[]): number[] {
  let reached = start;
  return deltas.map((delta) => {
    const step = dragSidebarWidth(reached, delta);
    reached = step.reached;
    return step.width;
  });
}

describe("sidebar width", () => {
  it("TEST_SCENARIO: a drag past either bound stops at that bound", () => {
    expect(clampSidebarWidth(100)).toBe(220);
    expect(clampSidebarWidth(2000)).toBe(520);
    expect(clampSidebarWidth(340)).toBe(340);
  });

  it("TEST_SCENARIO: a drag back from past the upper bound narrows the sidebar only once the pointer is back over the edge", () => {
    expect(drag(500, [100, -50, -50, -30])).toEqual([520, 520, 500, 470]);
  });

  it("TEST_SCENARIO: a drag back from past the lower bound widens the sidebar only once the pointer is back over the edge", () => {
    expect(drag(240, [-100, 40, 40, 30])).toEqual([220, 220, 220, 250]);
  });

  it("TEST_SCENARIO: a drag that ends where it started leaves the width where it was, however far past a bound it went", () => {
    expect(drag(400, [300, -100, -200])[2]).toBe(400);
  });
});

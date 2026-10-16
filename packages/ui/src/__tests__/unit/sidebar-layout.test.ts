import { describe, expect, it } from "vitest";

import { clampSidebarWidth } from "../../modules/platform/lib/sidebar-layout.js";

/**
 * TEST_OVERVIEW: The user drags the global sidebar wider or narrower, and the
 * width persists in browser storage. A drag must never make the sidebar
 * unusably narrow or wide.
 */

describe("sidebar width", () => {
  it("TEST_SCENARIO: a drag past either bound stops at that bound", () => {
    expect(clampSidebarWidth(100)).toBe(220);
    expect(clampSidebarWidth(2000)).toBe(520);
    expect(clampSidebarWidth(340)).toBe(340);
  });
});

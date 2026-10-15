import { describe, expect, it } from "vitest";

import {
  agentsSectionStyle,
  clampAgentsHeight,
  clampSidebarWidth,
  SIDEBAR_SECTION_MIN_PX,
  storedAgentsHeight,
} from "../../modules/platform/lib/sidebar-layout.js";

/**
 * TEST_OVERVIEW: The user drags the global sidebar wider or narrower, and drags
 * the divider between its Agents and Activity sections. Both sizes persist in
 * browser storage. A drag must never make the sidebar unusably narrow or wide,
 * and must never squeeze either section below its minimum height. A section
 * height that was never set lets Agents size to its content.
 */

describe("sidebar width", () => {
  it("TEST_SCENARIO: a drag past either bound stops at that bound", () => {
    expect(clampSidebarWidth(100)).toBe(220);
    expect(clampSidebarWidth(2000)).toBe(520);
    expect(clampSidebarWidth(340)).toBe(340);
  });
});

describe("sidebar section heights", () => {
  it("TEST_SCENARIO: the divider leaves both sections their minimum height", () => {
    expect(clampAgentsHeight(10, 600)).toBe(SIDEBAR_SECTION_MIN_PX);
    expect(clampAgentsHeight(590, 600)).toBe(600 - SIDEBAR_SECTION_MIN_PX);
    expect(clampAgentsHeight(250, 600)).toBe(250);
  });

  it("TEST_SCENARIO: a sidebar shorter than two minimums keeps Agents at its minimum", () => {
    expect(clampAgentsHeight(150, 120)).toBe(SIDEBAR_SECTION_MIN_PX);
  });

  it("TEST_SCENARIO: a stored height that is not positive counts as never set", () => {
    expect(storedAgentsHeight(null)).toBeNull();
    expect(storedAgentsHeight(0)).toBeNull();
    expect(storedAgentsHeight(-40)).toBeNull();
    expect(storedAgentsHeight(240)).toBe(240);
  });

  it("TEST_SCENARIO: Agents sizes to its content until the user drags the divider", () => {
    expect(agentsSectionStyle(null)).toMatchObject({ flex: "0 1 auto" });
    expect(agentsSectionStyle(240)).toMatchObject({ flex: "0 1 240px" });
  });
});

import { describe, expect, test } from "vitest";

import { isFeatureOffered } from "../../modules/features/lib/visible-features.js";

/**
 * TEST_OVERVIEW: The experimental features tab offers a feature only once the install has answered and only while the install leaves it experimental.
 */
describe("isFeatureOffered", () => {
  // TEST_SCENARIO: nothing is offered until the install has answered.
  test("offers nothing before the install answers", () => {
    expect(isFeatureOffered("processes", undefined)).toBe(false);
  });

  // TEST_SCENARIO: a feature the install pins on or off is hidden; an experimental or omitted one is offered.
  test("hides a feature the install pins", () => {
    const install = (mode?: "off" | "experimental" | "on") => ({
      features: mode ? { processes: mode } : {},
    });
    expect(isFeatureOffered("processes", install())).toBe(true);
    expect(isFeatureOffered("processes", install("experimental"))).toBe(true);
    expect(isFeatureOffered("processes", install("on"))).toBe(false);
    expect(isFeatureOffered("processes", install("off"))).toBe(false);
  });
});

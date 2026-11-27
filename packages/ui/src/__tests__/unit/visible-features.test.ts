import { describe, expect, test } from "vitest";

import {
  isFeatureOffered,
  offeredFeatures,
} from "../../modules/features/lib/visible-features.js";

/**
 * TEST_OVERVIEW: Settings offers a switch for a feature only once the install has answered and only while the install leaves the feature to each user. Experimental features lists the experimental ones and the hidden Internal features page lists the internal ones, which the install cannot pin.
 */
describe("the features Settings offers", () => {
  // TEST_SCENARIO: nothing is offered until the install has answered.
  test("offers nothing before the install answers", () => {
    expect(isFeatureOffered("custom-avatars", undefined)).toBe(false);
    expect(offeredFeatures("experimental", undefined)).toEqual([]);
  });

  // TEST_SCENARIO: a feature the install pins on or off is hidden; one left to each user, or omitted, is offered.
  test("hides a feature the install pins", () => {
    const install = (mode?: "off" | "user" | "on") => ({
      features: mode ? { "custom-avatars": mode } : {},
    });
    expect(isFeatureOffered("custom-avatars", install())).toBe(true);
    expect(isFeatureOffered("custom-avatars", install("user"))).toBe(true);
    expect(isFeatureOffered("custom-avatars", install("on"))).toBe(false);
    expect(isFeatureOffered("custom-avatars", install("off"))).toBe(false);
  });

  // TEST_SCENARIO: an install turned every experimental feature off. Experimental features then offers nothing, so its tab hides, while the internal features stay each person's own to switch.
  test("splits the switches by level", () => {
    const install = {
      features: {
        "custom-avatars": "off",
        dambledore: "off",
        environments: "user",
        hermes: "user",
      },
    } as const;
    expect(offeredFeatures("experimental", install)).toEqual([]);
    expect(offeredFeatures("internal", install)).toContain("environments");
    expect(offeredFeatures("internal", install)).not.toContain(
      "custom-avatars",
    );
    expect(
      offeredFeatures("experimental", {
        features: { "custom-avatars": "user" },
      }),
    ).toContain("custom-avatars");
  });
});

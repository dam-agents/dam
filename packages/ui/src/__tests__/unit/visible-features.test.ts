import { describe, expect, test } from "vitest";

import { isFeatureOffered } from "../../modules/features/lib/visible-features.js";

/**
 * TEST_OVERVIEW: The experimental features tab offers a feature only once the install has answered and only while the install leaves it experimental.
 */
describe("isFeatureOffered", () => {
  // TEST_SCENARIO: nothing is offered until the install has answered.
  test("offers nothing before the install answers", () => {
    expect(isFeatureOffered("agent-telemetry", undefined)).toBe(false);
  });

  // TEST_SCENARIO: a feature the install pins on or off is hidden; an experimental or omitted one is offered.
  test("hides a feature the install pins", () => {
    const install = (mode?: "off" | "experimental" | "on") => ({
      features: mode ? { "agent-telemetry": mode } : {},
    });
    expect(isFeatureOffered("agent-telemetry", install())).toBe(true);
    expect(isFeatureOffered("agent-telemetry", install("experimental"))).toBe(
      true,
    );
    expect(isFeatureOffered("agent-telemetry", install("on"))).toBe(false);
    expect(isFeatureOffered("agent-telemetry", install("off"))).toBe(false);
  });
});

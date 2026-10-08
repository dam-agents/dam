import { describe, expect, test } from "vitest";

import { isFeatureOffered } from "../../modules/features/lib/visible-features.js";

/**
 * TEST_OVERVIEW: The experimental features tab offers a feature only once the install has answered, only while the install leaves it experimental, and the new sandbox runtime only on an install that can run microVMs.
 */
describe("isFeatureOffered", () => {
  // TEST_SCENARIO: an install with virtualization on offers the new sandbox runtime.
  test("offers the new runtime when the install can run it", () => {
    expect(
      isFeatureOffered("vm-sandboxes", { virtualization: true, features: {} }),
    ).toBe(true);
  });

  // TEST_SCENARIO: an install without virtualization, or one that has not answered yet, hides it.
  test("hides the new runtime when the install cannot run it or has not said", () => {
    expect(
      isFeatureOffered("vm-sandboxes", { virtualization: false, features: {} }),
    ).toBe(false);
    expect(isFeatureOffered("vm-sandboxes", undefined)).toBe(false);
  });

  // TEST_SCENARIO: a feature the install pins on or off is hidden; an experimental or omitted one is offered.
  test("hides a feature the install pins", () => {
    const install = (mode?: "off" | "experimental" | "on") => ({
      virtualization: false,
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

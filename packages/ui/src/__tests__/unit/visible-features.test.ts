import { describe, expect, test } from "vitest";

import { isFeatureOffered } from "../../modules/features/lib/visible-features.js";

/**
 * TEST_OVERVIEW: The experimental features tab offers the new sandbox runtime only on an install that can run microVMs, and every other feature everywhere.
 */
describe("isFeatureOffered", () => {
  // TEST_SCENARIO: an install with virtualization on offers the new sandbox runtime.
  test("offers the new runtime when the install can run it", () => {
    expect(isFeatureOffered("vm-sandboxes", { virtualization: true })).toBe(
      true,
    );
  });

  // TEST_SCENARIO: an install without virtualization, or one that has not answered yet, hides it.
  test("hides the new runtime when the install cannot run it or has not said", () => {
    expect(isFeatureOffered("vm-sandboxes", { virtualization: false })).toBe(
      false,
    );
    expect(isFeatureOffered("vm-sandboxes", undefined)).toBe(false);
  });

  // TEST_SCENARIO: other features do not depend on the install.
  test("offers every other feature regardless of the install", () => {
    expect(isFeatureOffered("agent-avatars", undefined)).toBe(true);
  });
});

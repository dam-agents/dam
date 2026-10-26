import { expect, test } from "vitest";

import { sizeControlOffered } from "../../modules/sandboxes/lib/size-control.js";

// TEST_SCENARIO: the controller sizes a machine from its own spec on a host runner and wherever the runner pool sets no memory limit, so the 0.2.23 size control works there and must stay. Only a pool-sized runner takes half the owner pool and ignores the spec.
test("the size control stays unless the runner sizes from the pool", () => {
  expect(sizeControlOffered({ vm: true }, "spec")).toBe(true);
  expect(sizeControlOffered({ vm: true }, undefined)).toBe(true);
  expect(sizeControlOffered({ vm: false }, "pool")).toBe(true);
  expect(sizeControlOffered({ vm: true }, "pool")).toBe(false);
});

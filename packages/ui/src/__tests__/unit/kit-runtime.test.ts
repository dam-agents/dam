// TEST_OVERVIEW: whether a kit's agent is created on the new runtime, which
// TEST_OVERVIEW: the kit page asks before it shows a kit's size: a kit that
// TEST_OVERVIEW: asks for a machine does, a kit that names no backend follows
// TEST_OVERVIEW: the install, and only a container kit on an install that cannot
// TEST_OVERVIEW: virtualize shows a size at all.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import { kitRunsOnVm } from "../../modules/starter-kits/lib/catalog-cards.js";

const kit = (backend?: "vm") =>
  (backend ? { backend } : {}) as Pick<StarterKitView, "backend">;

describe("kitRunsOnVm", () => {
  // TEST_SCENARIO: a kit runs on the new runtime when it asks for a machine, or when the install makes machines of every agent it is not told otherwise about, and only then.
  test("follows the kit's backend, or the install", () => {
    expect(kitRunsOnVm(kit("vm"), false)).toBe(true);
    expect(kitRunsOnVm(kit(), true)).toBe(true);
    expect(kitRunsOnVm(kit(), false)).toBe(false);
  });

  // TEST_SCENARIO: before the install's answer arrives, only a kit that asks for a machine is known to run on one; any other kit is unknown, so no size shows yet and nothing flips once the answer arrives.
  test("is unknown until the install's answer arrives, unless the kit settles it", () => {
    expect(kitRunsOnVm(kit("vm"), undefined)).toBe(true);
    expect(kitRunsOnVm(kit(), undefined)).toBeUndefined();
  });
});

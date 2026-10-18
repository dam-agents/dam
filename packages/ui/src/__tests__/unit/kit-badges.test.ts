// TEST_OVERVIEW: a kit card shows the new runtime's badge when the kit itself asks for a
// TEST_OVERVIEW: machine, and for a kit that names no backend when the default runtime is the new one
// TEST_OVERVIEW: (the install pins it, or the owner opted in); the
// TEST_OVERVIEW: kit page reads the same rule, so the two never disagree.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  kitBadges,
  kitRunsOnVm,
  VM_BACKEND_LABEL,
} from "../../modules/starter-kits/lib/catalog-cards.js";

const kit = (backend?: "vm") =>
  ({
    schedules: [],
    channels: [],
    connections: [],
    skills: [],
    skillsInKit: [],
    ...(backend ? { backend } : {}),
  }) as unknown as StarterKitView;

const labels = (k: StarterKitView, defaultVm: boolean | undefined) =>
  kitBadges(k, [], new Map(), defaultVm).map((b) => b.label);

describe("kitBadges", () => {
  // TEST_SCENARIO: the badge follows the kit's own backend, and a new-runtime default puts it on every kit.
  test("shows the VM badge for a vm kit and for any kit when the default is a VM", () => {
    expect(labels(kit("vm"), false)).toContain(VM_BACKEND_LABEL);
    expect(labels(kit(), false)).not.toContain(VM_BACKEND_LABEL);
    expect(labels(kit(), true)).toContain(VM_BACKEND_LABEL);
  });
});

describe("kitRunsOnVm", () => {
  // TEST_SCENARIO: a kit runs on the new runtime when it asks for a machine or the default runtime is the new one, and only then.
  test("follows the kit's backend, or the default runtime", () => {
    expect(kitRunsOnVm(kit("vm"), false)).toBe(true);
    expect(kitRunsOnVm(kit(), true)).toBe(true);
    expect(kitRunsOnVm(kit(), false)).toBe(false);
  });

  // TEST_SCENARIO: before the default runtime is known, only a kit that asks for a machine is known to run on one; any other kit is unknown, so neither the VM badge nor a size shows yet and nothing flips once the answer arrives.
  test("is unknown until the default is known, unless the kit settles it", () => {
    expect(kitRunsOnVm(kit("vm"), undefined)).toBe(true);
    expect(kitRunsOnVm(kit(), undefined)).toBeUndefined();
    expect(labels(kit(), undefined)).not.toContain(VM_BACKEND_LABEL);
  });
});

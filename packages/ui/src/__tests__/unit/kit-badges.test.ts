// TEST_OVERVIEW: a kit card shows the new runtime's badge when the kit itself asks for a
// TEST_OVERVIEW: machine, and for every kit on an install that pins the new runtime on.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  kitBadges,
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

const labels = (k: StarterKitView, vmForced: boolean) =>
  kitBadges(k, [], new Map(), vmForced).map((b) => b.label);

describe("kitBadges", () => {
  // TEST_SCENARIO: the badge follows the kit's own backend, and a pinned install puts it on every kit.
  test("shows the VM badge for a vm kit and for any kit on a pinned install", () => {
    expect(labels(kit("vm"), false)).toContain(VM_BACKEND_LABEL);
    expect(labels(kit(), false)).not.toContain(VM_BACKEND_LABEL);
    expect(labels(kit(), true)).toContain(VM_BACKEND_LABEL);
  });
});

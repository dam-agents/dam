// TEST_OVERVIEW: A VM agent's configuration keeps the Sandbox section, which holds its credential injection switch, and describes it without the sleep timer and size that do not apply to VM agents.
import { describe, expect, it } from "vitest";

import { sectionsFor } from "../../modules/sandboxes/components/sandbox-section-nav.js";

describe("sectionsFor", () => {
  it("keeps the Sandbox section for a VM agent", () => {
    const setup = sectionsFor(true).find((e) => e.section === "setup");
    expect(setup?.description).toMatch(/credentials/);
  });

  it("lists the same sections for VM and container agents", () => {
    expect(sectionsFor(true).map((e) => e.section)).toEqual(
      sectionsFor(false).map((e) => e.section),
    );
  });
});

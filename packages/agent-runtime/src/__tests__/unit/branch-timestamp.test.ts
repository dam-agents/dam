// TEST_SCENARIO: the stamp names a publish branch, so two publishes a second apart must not collide and the name must stay sortable — which is the whole reason it is UTC and fixed-width. It replaced a formatter that cost 1.5 s to import for these fourteen characters, so what matters is that the characters did not change with it.
import { describe, expect, it } from "vitest";
import { branchTimestamp } from "../../modules/skills/domain/branch-timestamp.js";

describe("branch timestamp", () => {
  it("is the UTC instant as fourteen sortable digits", () => {
    expect(branchTimestamp(new Date("2026-09-17T15:04:05.123Z"))).toBe(
      "20260917150405",
    );
    expect(branchTimestamp(new Date("2001-02-03T04:05:06Z"))).toBe(
      "20010203040506",
    );
  });

  it("reads the instant in UTC, not wherever the agent happens to run", () => {
    expect(branchTimestamp(new Date("2026-01-01T00:30:00+02:00"))).toBe(
      "20251231223000",
    );
  });

  it("keeps later instants sorting after earlier ones", () => {
    const earlier = branchTimestamp(new Date("2026-09-17T15:04:05Z"));
    const later = branchTimestamp(new Date("2026-09-17T15:04:06Z"));
    expect(later > earlier).toBe(true);
  });
});

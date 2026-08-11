import { describe, expect, test } from "vitest";

import { durationBetween, formatDuration } from "../../lib/format-time.js";

describe("formatDuration", () => {
  test("scales units up to days", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(252_000)).toBe("4m 12s");
    expect(formatDuration(190_800_000)).toBe("2d 5h");
  });
});

describe("durationBetween", () => {
  test("spans two timestamps, null when an end is missing", () => {
    expect(
      durationBetween("2026-08-11T10:00:00Z", "2026-08-11T10:04:12Z"),
    ).toBe("4m 12s");
    expect(durationBetween("2026-08-11T10:00:00Z", null)).toBeNull();
  });
});

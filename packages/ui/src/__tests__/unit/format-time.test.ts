import { describe, expect, test } from "vitest";

import { formatDuration } from "../../lib/format-time.js";

describe("formatDuration", () => {
  test("scales units up to days", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(252_000)).toBe("4m 12s");
    expect(formatDuration(190_800_000)).toBe("2d 5h");
  });
});

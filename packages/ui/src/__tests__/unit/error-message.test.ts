import { describe, expect, test } from "vitest";

import { getErrorMessage } from "../../lib/errors.js";

describe("getErrorMessage", () => {
  test("turns a tRPC input-validation message into the issue text", () => {
    const message = JSON.stringify([
      {
        code: "invalid_format",
        path: ["envName"],
        message:
          "env var name must be letters, digits, and underscores (not starting with a digit)",
      },
      { code: "too_small", path: [], message: "required" },
    ]);
    expect(getErrorMessage(new Error(message))).toBe(
      "env var name must be letters, digits, and underscores (not starting with a digit); required",
    );
  });

  test("leaves a plain or bracketed non-issue message alone", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage(new Error("[1,2]"))).toBe("[1,2]");
    expect(getErrorMessage(new Error("[not json"))).toBe("[not json");
  });
});

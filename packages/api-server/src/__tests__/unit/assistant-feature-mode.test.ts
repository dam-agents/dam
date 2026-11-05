// TEST_OVERVIEW: The assistant is an experimental feature like any other: the install's mode decides, and in `experimental` the person's own switch does. Nobody has one until they switch it on, and switching it on is what provisions it — including the one-time rename of an Agent that already holds the reserved name.
import { describe, expect, it } from "vitest";
import { featureOnForUser } from "api-server-api";

describe("who has the assistant on", () => {
  // TEST_SCENARIO: an install whose mode is experimental gives nobody an assistant until they switch it on, which is what the chart's featureDefault does by default; `on` gives it to everyone and `off` to nobody, whatever they stored.
  it("follows the install's mode, and the person's switch only in experimental", () => {
    expect(featureOnForUser("experimental", false)).toBe(false);
    expect(featureOnForUser("experimental", true)).toBe(true);
    expect(featureOnForUser("on", false)).toBe(true);
    expect(featureOnForUser("off", true)).toBe(false);
  });
});

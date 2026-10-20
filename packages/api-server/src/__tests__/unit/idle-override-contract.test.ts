import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { goDurationToMinutes, parseGoDurationNs } from "../../duration.js";

/**
 * TEST_OVERVIEW: The Agent's hibernation override is a Go duration, read by
 * the controller and read again here for the UI and the usage report. Both
 * sides read the golden cases beside the controller, so a duration form the
 * controller accepts and this side drops fails here rather than reading as
 * never-hibernate — the one classification that keeps a machine up.
 */

const contract = (): {
  cases: { duration: string; minutes: number }[];
} =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../../controller/contract/idle-override.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

describe("the idle override projection", () => {
  it.each(contract().cases)(
    "reads $duration as $minutes minutes",
    ({ duration, minutes }) => {
      expect(goDurationToMinutes(duration)).toBe(minutes);
    },
  );

  // TEST_SCENARIO: A fraction longer than a double can hold must not turn a
  // TEST_SCENARIO: finite duration into NaN, which reads as no window at all.
  it("keeps a long fractional term finite and truncates it as Go does", () => {
    expect(parseGoDurationNs("1." + "0".repeat(320) + "s")).toBe(1e9);
    expect(parseGoDurationNs("0." + "0".repeat(40) + "1s")).toBe(0);
  });

  it("inherits the default for a value the controller cannot parse", () => {
    expect(goDurationToMinutes("1d")).toBeNull();
    expect(goDurationToMinutes("")).toBeNull();
    expect(goDurationToMinutes("5")).toBeNull();
    expect(goDurationToMinutes("1..5h")).toBeNull();
  });
});

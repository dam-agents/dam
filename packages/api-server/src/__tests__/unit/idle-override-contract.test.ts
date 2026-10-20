import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { goDurationToMinutes } from "../../duration.js";

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

  it("inherits the default for a value the controller cannot parse", () => {
    expect(goDurationToMinutes("1d")).toBeNull();
    expect(goDurationToMinutes("")).toBeNull();
    expect(goDurationToMinutes("5")).toBeNull();
    expect(goDurationToMinutes("1..5h")).toBeNull();
  });
});

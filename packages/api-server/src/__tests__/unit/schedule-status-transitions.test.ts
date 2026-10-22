import { describe, expect, it } from "vitest";

import { statusForVerdict } from "../../modules/schedules/domain/status-transitions.js";

const AT = new Date("2026-06-12T10:30:00Z");

// TEST_OVERVIEW: What each Precheck verdict does to a Schedule's status, and why the two counters clear on different events.
describe("schedule status transitions", () => {
  // TEST_SCENARIO: a decline is not a run, so it must never touch the last-run pair.
  it("a decline counts itself and leaves the last-run pair alone", () => {
    const patch = statusForVerdict("declined", AT, null);

    expect(patch.lastFiredAt).toBeUndefined();
    expect(patch.lastFiredResult).toBeUndefined();
    expect(patch.declinedCount).toEqual({ kind: "increment" });
    expect(patch.lastDeclinedAt).toEqual(AT);
  });

  // TEST_SCENARIO: the decline count is since work last happened, so work happening clears it.
  it("a run clears the decline count", () => {
    const patch = statusForVerdict("allowed", AT, null);

    expect(patch.declinedCount).toEqual({ kind: "set", value: 0 });
    expect(patch.lastDeclinedAt).toBeNull();
    expect(patch.lastPrecheckError).toBeNull();
  });

  // TEST_SCENARIO: a broken Precheck let its run happen, so that run must not clear the failure count.
  it("a broken precheck records its run and still raises the failure count", () => {
    const patch = statusForVerdict("precheck-failed", AT, "precheck exited 2");

    expect(patch.lastFiredAt).toEqual(AT);
    expect(patch.precheckFailedCount).toEqual({ kind: "increment" });
    expect(patch.lastPrecheckError).toBe("precheck exited 2");
  });

  // TEST_SCENARIO: only a returned verdict says the breakage is over, and exit 1 is as valid a verdict as exit 0.
  it("either verdict clears the failure count, a decline included", () => {
    expect(statusForVerdict("allowed", AT, null).precheckFailedCount).toEqual({
      kind: "set",
      value: 0,
    });
    expect(statusForVerdict("declined", AT, null).precheckFailedCount).toEqual({
      kind: "set",
      value: 0,
    });
  });

  // TEST_SCENARIO: a decline is proof the schedule works again, so a refusal it settles must not stay on the card as the schedule's last result.
  it("a decline clears a refused fire's reason", () => {
    const patch = statusForVerdict(
      "declined",
      AT,
      null,
      "this agent holds no openai provider",
    );

    expect(patch.lastFiredResult).toBeNull();
    expect(patch.lastFiredAt).toBeUndefined();
  });

  // TEST_SCENARIO: a run that finished and a hold are both facts the owner wants kept, so neither is cleared the way a failure is.
  it("a decline keeps a finished run and a hold", () => {
    for (const kept of ["success", "held: agent disabled"])
      expect(statusForVerdict("declined", AT, null, kept)).not.toHaveProperty(
        "lastFiredResult",
      );
  });
});

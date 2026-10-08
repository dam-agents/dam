import { describe, expect, it } from "vitest";
import type { ScheduleSpecOnce } from "api-server-api";
import { onceFireAction } from "../../modules/schedules/domain/once.js";

const spec: ScheduleSpecOnce = {
  version: "1",
  type: "once",
  at: "2026-06-12T10:30:00.000Z",
  timezone: "UTC",
  task: "do the thing",
  enabled: true,
  createdBy: "agent",
};
const lastRun = "2026-06-12T10:30:00.000Z";

describe("onceFireAction", () => {
  // TEST_SCENARIO: a one-time fire's recorded result decides the fire. No result commits inside the 24-hour window and is missed after it; delivering owes only the poke; any settled result drops, so a stale retry cannot write delivering over it.
  it("selects commit, missed, poke or drop from the recorded result", () => {
    const due = new Date("2026-06-12T10:30:00Z");

    expect(onceFireAction(spec, undefined, due)).toEqual({
      kind: "commit",
      expiresAt: new Date("2026-06-13T10:30:00.000Z"),
    });
    expect(
      onceFireAction(spec, undefined, new Date("2026-06-13T10:30:00Z")),
    ).toEqual({ kind: "missed" });
    expect(
      onceFireAction(spec, { lastRun, lastResult: "delivering" }, due),
    ).toEqual({ kind: "poke" });
    for (const lastResult of ["success", "missed", "failed: no model"])
      expect(onceFireAction(spec, { lastRun, lastResult }, due)).toEqual({
        kind: "drop",
      });
  });
});

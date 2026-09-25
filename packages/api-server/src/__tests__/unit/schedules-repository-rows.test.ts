// TEST_OVERVIEW: Reading schedule rows. The `enabled` column is the source of truth, and the `spec` jsonb keeps a copy of it. A read must never fail because that copy drifted, and one unreadable row must not hide the other schedules of the agent.
import { describe, it, expect } from "vitest";
import {
  rowToSchedule,
  rowsToSchedules,
  type InternalRow,
} from "../../modules/schedules/infrastructure/schedules-repository.js";

function row(overrides: Partial<InternalRow> = {}): InternalRow {
  return {
    id: "sched-1",
    agentId: "agent-1",
    owner: "owner-1",
    name: "daily",
    spec: {
      version: "1",
      type: "cron",
      cron: "0 9 * * *",
      task: "do the thing",
      enabled: true,
      createdBy: "user",
    },
    enabled: true,
    nextRun: null,
    lastFiredAt: null,
    lastFiredResult: null,
    lastDeclinedAt: null,
    declinedCount: 0,
    lastPrecheckError: null,
    precheckFailedCount: 0,
    ...overrides,
  };
}

describe("rowToSchedule", () => {
  // TEST_SCENARIO: A row whose spec copy of `enabled` is the string "false" was written outside the API. The column says disabled, so the Schedule reads as disabled and the parse succeeds.
  it("takes enabled from the column when the spec copy is not a boolean", () => {
    const r = row({
      enabled: false,
      spec: { ...(row().spec as object), enabled: "false" },
    });

    expect(rowToSchedule(r).spec.enabled).toBe(false);
  });

  // TEST_SCENARIO: The spec copy disagrees with the column. The column wins.
  it("prefers the column over a contradicting spec copy", () => {
    const r = row({
      enabled: true,
      spec: { ...(row().spec as object), enabled: false },
    });

    expect(rowToSchedule(r).spec.enabled).toBe(true);
  });
});

describe("rowsToSchedules", () => {
  // TEST_SCENARIO: One row has a spec that cannot be parsed at all. The list still returns the other schedules instead of failing, so the Schedules tab is not empty.
  it("skips an unreadable row and keeps the rest", () => {
    const good = row({ id: "sched-good" });
    const bad = row({ id: "sched-bad", spec: { type: "cron" } });

    expect(rowsToSchedules([bad, good]).map((s) => s.id)).toEqual([
      "sched-good",
    ]);
  });
});

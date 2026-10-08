// TEST_OVERVIEW: the rows of the Settings list of every schedule a user owns, across their agents. Each row names its agent, says what is wrong with it when something is, and the list puts what runs next first, so a user sees what runs tonight and what is failing without opening each agent.
import { describe, expect, it } from "vitest";

import { ownerScheduleRows } from "../../modules/schedules/lib/owner-schedules.js";
import type { Schedule } from "../../types.js";

const base: Schedule = {
  id: "s",
  name: "s",
  agentId: "agent-1",
  type: "rrule",
  cron: null,
  rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  timezone: "UTC",
  quietHours: [],
  task: "Triage the new issues",
  precheck: null,
  enabled: true,
  createdBy: "user",
  status: null,
  at: null,
  inSession: null,
  model: null,
  sessionTitle: null,
};

const agents = [
  { id: "agent-1", name: "Triage bot" },
  { id: "agent-2", name: "Release bot" },
];

function sched(over: Partial<Schedule>): Schedule {
  return { ...base, ...over };
}

describe("ownerScheduleRows", () => {
  it("names each schedule's agent, and falls back to its id", () => {
    const rows = ownerScheduleRows(
      [
        sched({ id: "a", agentId: "agent-2" }),
        sched({ id: "b", agentId: "gone" }),
      ],
      agents,
    );
    expect(rows.map((r) => r.agentName)).toEqual(["Release bot", "gone"]);
  });

  it("lists active schedules by next run, then paused and finished ones by last run", () => {
    const rows = ownerScheduleRows(
      [
        sched({
          id: "paused-old",
          enabled: false,
          status: { lastRun: "2026-10-01T09:00:00Z" },
        }),
        sched({ id: "later", status: { nextRun: "2026-10-09T09:00:00Z" } }),
        sched({
          id: "done-once",
          type: "once",
          at: "2026-10-05T09:00:00Z",
          status: { lastRun: "2026-10-05T09:00:00Z", lastResult: "success" },
        }),
        sched({ id: "no-next", name: "z" }),
        sched({ id: "sooner", status: { nextRun: "2026-10-08T21:00:00Z" } }),
      ],
      agents,
    );
    expect(rows.map((r) => [r.schedule.id, r.active])).toEqual([
      ["sooner", true],
      ["later", true],
      ["no-next", true],
      ["done-once", false],
      ["paused-old", false],
    ]);
  });

  it("flags a stopped schedule and a failing precheck", () => {
    const [stopped, failing, fine] = ownerScheduleRows(
      [
        sched({
          id: "stopped",
          name: "a",
          status: { stopReason: "the rule never fires again" },
        }),
        sched({
          id: "failing",
          name: "b",
          precheck: "test -f /tmp/x",
          status: { lastPrecheckError: "exit 127", precheckFailedCount: 3 },
        }),
        sched({ id: "fine", name: "c" }),
      ],
      agents,
    );
    expect(stopped!.problem).toBe("Stopped: the rule never fires again");
    expect(failing!.problem).toBe(
      "Precheck failed 3 times in a row — running every time",
    );
    expect(fine!.problem).toBeNull();
  });

  it("does not flag a paused schedule for the reason it would stop", () => {
    const [row] = ownerScheduleRows(
      [sched({ enabled: false, status: { stopReason: "never fires" } })],
      agents,
    );
    expect(row!.problem).toBeNull();
  });
});

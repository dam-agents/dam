// TEST_OVERVIEW: the copy the Run now action shows before and after it fires. Run now resolves when the fire is delivered, not when the task has run, so the text must promise only what has actually happened — and it must say whether the Precheck decides next, because a declined Precheck opens no session for the owner to read.
import { describe, expect, it } from "vitest";

import {
  runNowConfirmText,
  runNowStartedText,
} from "../../modules/schedules/lib/schedule-format.js";
import type { Schedule } from "../../types.js";

const base: Schedule = {
  id: "sched-1",
  name: "nightly triage",
  agentId: "agent-1",
  type: "rrule",
  cron: null,
  rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  timezone: "Europe/Prague",
  quietHours: [],
  task: "Triage the new issues",
  precheck: null,
  enabled: true,
  createdBy: "user",
  status: null,
};

const prechecked: Schedule = { ...base, precheck: "test -f /tmp/ready" };

describe("runNowConfirmText", () => {
  // TEST_SCENARIO: going through the Precheck is what makes it testable, so the owner must know before confirming that the check can decline the run they asked for.
  it("says the precheck decides first when the schedule has one", () => {
    expect(runNowConfirmText(prechecked)).toContain(
      "precheck decides it first",
    );
    expect(runNowConfirmText(base)).toContain("task runs once");
  });

  // TEST_SCENARIO: not moving the next occurrence is the whole point of the action, so the confirm says so — and on a paused schedule it says the pause survives instead, since that schedule has no next run to move.
  it("promises the cadence is untouched, and says paused stays paused", () => {
    expect(runNowConfirmText(base)).toContain("next run is not moved");
    expect(runNowConfirmText({ ...base, enabled: false })).toContain(
      "stays paused",
    );
  });
});

describe("runNowStartedText", () => {
  // TEST_SCENARIO: the mutation resolves once the fire is delivered, before the Precheck has decided. A declined check opens no session, and the results list holds sessions only — so promising the run appears there would leave the owner reading an empty list after a success message.
  it("promises a readable run only when no precheck can withhold it", () => {
    expect(runNowStartedText(base)).toContain("appears under View results");
    expect(runNowStartedText(prechecked)).toContain("precheck decides next");
    expect(runNowStartedText(prechecked)).toContain("only if it allows");
  });
});

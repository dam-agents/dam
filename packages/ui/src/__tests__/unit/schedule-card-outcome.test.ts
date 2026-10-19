// TEST_OVERVIEW: the outcome line a schedule's card carries in an Agent's schedules panel. It is the only place a user scanning the list sees that a schedule stopped working, so a recurring schedule's failure must appear there with its reason, not only inside the details card.
import { describe, expect, it } from "vitest";

import { cardOutcome } from "../../modules/schedules/lib/schedule-format.js";
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
  at: null,
  inSession: null,
  harness: null,
  model: null,
  settings: null,
  migrationNote: null,
  sessionTitle: null,
};

describe("cardOutcome", () => {
  // TEST_SCENARIO: a schedule whose saved model names a provider the agent no longer holds is refused on every fire. The card must show that reason, in the danger colour, so the failure is visible without opening the schedule's details.
  it("shows a recurring schedule's failure with its reason", () => {
    const refused: Schedule = {
      ...base,
      model: "openai/gpt-5.5",
      status: {
        lastRun: "2026-06-12T09:00:00.000Z",
        lastResult: "this agent holds no openai provider",
      },
    };

    expect(cardOutcome(refused)).toEqual({
      label: "Failed: this agent holds no openai provider",
      className: "text-danger",
      failed: true,
    });
  });

  // TEST_SCENARIO: the line is for what needs attention. A recurring schedule whose last fire succeeded repeats the same outcome on every card forever, so it says nothing there; the details card and the results modal carry it.
  it("says nothing for a recurring schedule whose last fire succeeded", () => {
    const working: Schedule = {
      ...base,
      status: { lastRun: "2026-06-12T09:00:00.000Z", lastResult: "success" },
    };

    expect(cardOutcome(working)).toBeNull();
  });

  // TEST_SCENARIO: a one-time schedule has no next occurrence to pay back a lost run, so its card keeps showing every outcome it reaches, as it did before.
  it("shows a one-time schedule's outcome once it has fired", () => {
    const done: Schedule = {
      ...base,
      type: "once",
      at: "2026-06-12T09:00:00.000Z",
      status: { lastRun: "2026-06-12T09:00:00.000Z", lastResult: "success" },
    };
    const pending: Schedule = { ...base, type: "once", status: null };

    expect(cardOutcome(done)).toMatchObject({ label: "Succeeded" });
    expect(cardOutcome(pending)).toBeNull();
  });
});

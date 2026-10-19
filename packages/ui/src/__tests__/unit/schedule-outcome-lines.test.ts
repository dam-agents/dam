// TEST_OVERVIEW: the outcome lines the schedules surfaces show from a schedule's last result. A failure must be readable wherever it is listed, even before the schedule ever ran, because that is the only sign a schedule stopped working.
import { describe, expect, it } from "vitest";

import {
  cardOutcome,
  runOutcomeLine,
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
  at: null,
  inSession: null,
  harness: null,
  model: null,
  settings: null,
  migrationNote: null,
  sessionTitle: null,
};

const refusal =
  "no model provider granted to this agent can run its harness; grant one to run this schedule";

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

describe("runOutcomeLine", () => {
  // TEST_SCENARIO: a schedule refused before its first fire has a result and no run time. The owner list and the results modal must still show the reason, or a schedule that never worked reads as a healthy one with an upcoming run.
  it("shows the reason with no run time before the first run", () => {
    const refused: Schedule = { ...base, status: { lastResult: refusal } };

    expect(runOutcomeLine(refused)).toEqual({
      lastRunText: null,
      resultText: `Last result: Failed: ${refusal}`,
      className: "text-danger",
    });
  });

  // TEST_SCENARIO: the run time and the result carry their own qualifiers, so a refusal that follows a successful run cannot be read as that run's outcome.
  it("gives the run time and the result their own qualifiers", () => {
    const ran: Schedule = {
      ...base,
      status: { lastRun: "2026-06-12T09:00:00.000Z", lastResult: "success" },
    };

    expect(runOutcomeLine(ran)).toMatchObject({
      resultText: "Last result: Succeeded",
      className: "text-success",
    });
    expect(runOutcomeLine(ran)?.lastRunText).toBeTruthy();
  });

  // TEST_SCENARIO: a cleared result is not a fire that never happened — a schedule that ran still names when, so the surface keeps the run after the reason it cleared.
  it("keeps the run time once a result is cleared", () => {
    const ran: Schedule = {
      ...base,
      status: { lastRun: "2026-06-12T09:00:00.000Z" },
    };

    const line = runOutcomeLine(ran);

    expect(line?.lastRunText).toBeTruthy();
    expect(line?.resultText).toBeNull();
  });

  // TEST_SCENARIO: a schedule that never fired and never failed carries no line, so the surfaces stay quiet about work that has not happened.
  it("says nothing when no result is recorded", () => {
    expect(runOutcomeLine(base)).toBeNull();
  });
});

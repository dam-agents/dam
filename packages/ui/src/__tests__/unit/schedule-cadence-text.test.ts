// TEST_OVERVIEW: what a schedule row says about when it runs. A repeating schedule's time belongs to the schedule's own time zone, so the row names that zone whenever it is not the one the reader's clock runs on, and says a cron in the words the cron form does rather than as its raw expression.
import { describe, expect, it } from "vitest";

import { scheduleCadenceText } from "../../modules/schedules/lib/schedule-format.js";
import type { Schedule } from "../../types.js";

const base: Schedule = {
  id: "sched-1",
  name: "daily brief",
  agentId: "agent-1",
  type: "rrule",
  cron: null,
  rrule: "FREQ=DAILY;BYHOUR=15;BYMINUTE=35",
  timezone: "America/New_York",
  quietHours: [],
  task: "Summarise the mail",
  precheck: null,
  enabled: true,
  createdBy: "user",
  status: null,
  at: null,
  inSession: null,
  harness: null,
  model: null,
  settings: null,
  profile: null,
  migrationNote: null,
  sessionTitle: null,
};

describe("scheduleCadenceText", () => {
  // TEST_SCENARIO: a New York schedule read in Prague says whose 3:35 PM it is.
  it("names the zone of a schedule that is not on the reader's clock", () => {
    expect(scheduleCadenceText(base, "Europe/Prague")).toContain(
      "(America/New_York)",
    );
  });

  // TEST_SCENARIO: a reader in the schedule's own zone has nothing to translate, so the row stays short.
  it("leaves the zone out when it is the reader's own", () => {
    expect(
      scheduleCadenceText(
        { ...base, timezone: "Europe/Prague" },
        "Europe/Prague",
      ),
    ).not.toContain("Europe/Prague");
  });

  // TEST_SCENARIO: a cron runs in UTC and its raw expression is not a sentence, so the row reads as the cron form's preview does.
  it("writes a cron in words, in UTC", () => {
    const cron: Schedule = {
      ...base,
      type: "cron",
      rrule: null,
      cron: "0 13 * * 1",
      timezone: null,
    };
    expect(scheduleCadenceText(cron, "Europe/Prague")).toBe(
      "At 01:00 PM, only on Monday (UTC)",
    );
  });
});

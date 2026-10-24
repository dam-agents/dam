// TEST_OVERVIEW: After a schedule is created in the side panel beside the chat, the chat offers the shortest prompt that gives the same schedule back: its cadence, the zone the form saved for a time of day, and the whole task. The prompt is left out whenever it would build a different schedule — an advanced field, an rrule the presets only partly describe, or no zone for a time of day.
import { ALL_DAYS, buildRRule, type FrequencyPreset } from "api-server-api";
import { expect, it } from "vitest";

import { justAskPrompt } from "../../modules/schedules/lib/just-ask.js";

const TZ = "Europe/Prague";

function prompt(rrule: string, task = "triage new issues") {
  return justAskPrompt({ rrule, timezone: TZ, task, advanced: false });
}

// TEST_SCENARIO: a daily schedule at 3pm in the user's zone becomes "3pm Europe/Prague daily" and its task, the sentence a user would type instead of filling the form. The zone is part of it because a bare time means another schedule to an Agent that thinks in UTC.
it("turns a daily schedule into the sentence that gives it back", () => {
  const rrule = buildRRule({
    kind: "daily",
    hour: 15,
    minute: 0,
    days: ALL_DAYS,
  });
  expect(prompt(rrule)).toBe("3pm Europe/Prague daily triage new issues");
});

// TEST_SCENARIO: the cadence keeps the days the user picked, in the words they would use: weekdays, one weekday, the weekend, and a handful of days.
it("names the days of the cadence", () => {
  const daily = (days: number[]): FrequencyPreset => ({
    kind: "daily",
    hour: 9,
    minute: 0,
    days,
  });
  expect(
    prompt(buildRRule(daily([1, 2, 3, 4, 5])), "review pull requests"),
  ).toBe("9am Europe/Prague every weekday review pull requests");
  expect(
    prompt(
      buildRRule({ kind: "daily", hour: 18, minute: 30, days: [1] }),
      "Post the digest",
    ),
  ).toBe("6:30pm Europe/Prague every Monday Post the digest");
  expect(prompt(buildRRule(daily([6, 7])), "check backups")).toBe(
    "9am Europe/Prague on weekends check backups",
  );
  expect(prompt(buildRRule(daily([1, 3])), "water the plants")).toBe(
    "9am Europe/Prague on Monday, Wednesday water the plants",
  );
});

// TEST_SCENARIO: the whole task goes in, however many sentences it has, because a shortened task describes another one.
it("keeps the whole task", () => {
  const rrule = buildRRule({
    kind: "daily",
    hour: 15,
    minute: 0,
    days: ALL_DAYS,
  });
  expect(
    prompt(
      rrule,
      "Triage new issues.\nThen label them and tell the on-call engineer.",
    ),
  ).toBe(
    "3pm Europe/Prague daily Triage new issues. Then label them and tell the on-call engineer.",
  );
});

// TEST_SCENARIO: a time of day without a zone is not the same schedule elsewhere, and an rrule that only partly matches a preset (a COUNT, or WEEKLY with no BYDAY) fires on other days, so neither gets a prompt. The form's own rrules always round-trip.
it("refuses a cadence it cannot give back exactly", () => {
  expect(
    prompt("FREQ=DAILY;BYHOUR=9;BYMINUTE=0;COUNT=3", "send the report"),
  ).toBe(null);
  expect(prompt("FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0", "send the report")).toBe(
    null,
  );
  expect(
    justAskPrompt({
      rrule: buildRRule({
        kind: "daily",
        hour: 9,
        minute: 0,
        days: ALL_DAYS,
      }),
      timezone: "",
      task: "send the report",
      advanced: false,
    }),
  ).toBe(null);
});

// TEST_SCENARIO: intervals read as "every 2 hours" and "every 15 minutes", and they carry no zone because they do not depend on one.
it("names the intervals without a zone", () => {
  expect(
    prompt(
      buildRRule({ kind: "hourly", interval: 2, days: ALL_DAYS }),
      "check the queue",
    ),
  ).toBe("every 2 hours check the queue");
  expect(
    prompt(
      buildRRule({ kind: "minutely", interval: 15, days: ALL_DAYS }),
      "poll the build",
    ),
  ).toBe("every 15 minutes poll the build");
  expect(
    prompt(buildRRule({ kind: "hourly", interval: 1, days: ALL_DAYS })),
  ).toBe("every hour triage new issues");
});

// TEST_SCENARIO: a schedule the sentence cannot carry — a precheck, quiet hours, a model override, or a session that continues — gets no hint, because the prompt would build another schedule.
it("has no prompt once an advanced field is set", () => {
  const rrule = buildRRule({
    kind: "daily",
    hour: 15,
    minute: 0,
    days: ALL_DAYS,
  });
  expect(
    justAskPrompt({
      rrule,
      timezone: TZ,
      task: "triage new issues",
      advanced: true,
    }),
  ).toBe(null);
  expect(
    prompt(buildRRule({ kind: "minutely", interval: 5, days: ALL_DAYS }), " "),
  ).toBe(null);
});

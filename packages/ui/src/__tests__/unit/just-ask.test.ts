// TEST_OVERVIEW: After a schedule is created in the side panel beside the chat, the chat offers the shortest prompt that gives the same schedule back: its cadence in the user's own terms and the task it runs. A cadence no preset describes gets no prompt, because a wrong prompt is worse than none.
import { buildRRule } from "api-server-api";
import { expect, it } from "vitest";

import { justAskPrompt } from "../../modules/schedules/lib/just-ask.js";

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

// TEST_SCENARIO: a daily schedule at 3pm becomes "3pm daily" and its task, the sentence a user would type instead of filling the form.
it("turns a daily schedule into the sentence that gives it back", () => {
  const rrule = buildRRule({
    kind: "daily",
    hour: 15,
    minute: 0,
    days: ALL_DAYS,
  });
  expect(justAskPrompt(rrule, "Triage new issues.")).toBe(
    "3pm daily triage new issues",
  );
});

// TEST_SCENARIO: the cadence keeps the days the user picked, in the words they would use: weekdays, one weekday, the weekend.
it("names the days of the cadence", () => {
  const weekdays = buildRRule({
    kind: "daily",
    hour: 9,
    minute: 0,
    days: [1, 2, 3, 4, 5],
  });
  expect(justAskPrompt(weekdays, "review pull requests")).toBe(
    "9am every weekday review pull requests",
  );
  const monday = buildRRule({
    kind: "daily",
    hour: 18,
    minute: 30,
    days: [1],
  });
  expect(justAskPrompt(monday, "Post the digest")).toBe(
    "6:30pm every Mon post the digest",
  );
  const weekend = buildRRule({
    kind: "daily",
    hour: 10,
    minute: 0,
    days: [6, 7],
  });
  expect(justAskPrompt(weekend, "check backups")).toBe(
    "10am every weekend day check backups",
  );
});

// TEST_SCENARIO: a task that is a whole paragraph is cut to its first sentence, so the hint stays a prompt and not a description.
it("keeps the task to its first sentence", () => {
  const rrule = buildRRule({
    kind: "daily",
    hour: 15,
    minute: 0,
    days: ALL_DAYS,
  });
  expect(
    justAskPrompt(
      rrule,
      "Triage new issues.\nThen label them and tell the on-call engineer.",
    ),
  ).toBe("3pm daily triage new issues");
});

// TEST_SCENARIO: a task starting with an acronym or a name keeps its capital, because lowercasing it would change the words the user typed.
it("keeps a capital that is part of a name", () => {
  const rrule = buildRRule({
    kind: "daily",
    hour: 15,
    minute: 0,
    days: ALL_DAYS,
  });
  expect(justAskPrompt(rrule, "PRs waiting on review")).toBe(
    "3pm daily PRs waiting on review",
  );
  expect(justAskPrompt(rrule, "GitHub alerts")).toBe("3pm daily GitHub alerts");
});

// TEST_SCENARIO: intervals read as "every 2 hours" and "every 15 minutes", while a cadence no preset describes, such as monthly, gets no prompt at all.
it("handles intervals and refuses cadences it cannot name", () => {
  expect(
    justAskPrompt(
      buildRRule({ kind: "hourly", interval: 2, days: ALL_DAYS }),
      "check the queue",
    ),
  ).toBe("every 2 hours check the queue");
  expect(
    justAskPrompt(
      buildRRule({ kind: "minutely", interval: 15, days: ALL_DAYS }),
      "poll the build",
    ),
  ).toBe("every 15 minutes poll the build");
  expect(
    justAskPrompt(
      "FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0",
      "send the report",
    ),
  ).toBe(null);
  expect(
    justAskPrompt(
      buildRRule({ kind: "daily", hour: 9, minute: 0, days: ALL_DAYS }),
      "  ",
    ),
  ).toBe(null);
});

// TEST_OVERVIEW: a user's cron schedule opens in its own editor, where the cron expression itself is edited and checked with the parser the api-server fires it with, so a refused expression shows its reason inline instead of failing on save.
import { describe, expect, it } from "vitest";

import {
  cronFormDefaults,
  cronFormSchema,
} from "../../modules/schedules/forms/cron-form-schema.js";
import { nextCronRuns } from "../../modules/schedules/lib/cron-conversion.js";
import { scheduleLock } from "../../modules/schedules/lib/schedule-lock.js";
import type { Schedule } from "../../types.js";

const cronSchedule: Schedule = {
  id: "s",
  name: "Weekday digest",
  agentId: "agent-1",
  type: "cron",
  cron: "30 7 * * 1-5",
  rrule: null,
  timezone: null,
  quietHours: [],
  task: "Post the digest",
  precheck: null,
  enabled: true,
  sessionMode: "continuous",
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

function cronIssues(cron: string): string[] {
  const result = cronFormSchema.safeParse({
    ...cronFormDefaults(cronSchedule),
    cron,
  });
  return result.success
    ? []
    : result.error.issues
        .filter((i) => i.path.join(".") === "cron")
        .map((i) => i.message);
}

describe("the cron schedule editor", () => {
  // TEST_SCENARIO: the edit action used to stop at a notice for a cron schedule; a user's own cron schedule now opens in the editor.
  it("does not lock a user's cron schedule", () => {
    expect(scheduleLock(cronSchedule)).toBeNull();
    expect(scheduleLock({ ...cronSchedule, createdBy: "agent" })).toBe(
      "agent-managed",
    );
  });

  it("starts from the schedule's own fields", () => {
    expect(cronFormDefaults(cronSchedule)).toEqual({
      name: "Weekday digest",
      cron: "30 7 * * 1-5",
      task: "Post the digest",
      precheck: "",
      model: "",
      sessionTitle: "",
      sessionMode: "continuous",
    });
  });

  it.each(["0 9 * * *", "*/15 9-17 * * MON-FRI", "@daily"])(
    "accepts %s",
    (cron) => {
      expect(cronIssues(cron)).toEqual([]);
    },
  );

  it.each([
    ["", "Required"],
    ["every day", /^Not accepted: /],
    ["61 * * * *", /^Not accepted: /],
  ])("refuses %j", (cron, message) => {
    const issues = cronIssues(cron);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(message);
  });

  it("previews the next runs in UTC", () => {
    expect(
      nextCronRuns("30 7 * * 1-5", new Date("2026-10-16T08:00:00Z"), 2),
    ).toEqual([
      new Date("2026-10-19T07:30:00Z"),
      new Date("2026-10-20T07:30:00Z"),
    ]);
    expect(nextCronRuns("every day", new Date(), 2)).toEqual([]);
  });
});

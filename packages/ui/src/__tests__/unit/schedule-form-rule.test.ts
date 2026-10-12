// TEST_OVERVIEW: the schedule form's cadence preview and its validation must agree with what the api-server accepts, so a rule the save call would refuse shows its reason inline and never a preview.
import { describe, expect, it } from "vitest";

import {
  buildRRuleParts,
  scheduleFormDefaults,
  scheduleFormSchema,
  type ScheduleFormValues,
} from "../../modules/schedules/forms/schedule-form-schema.js";

const base: ScheduleFormValues = {
  ...scheduleFormDefaults(),
  name: "digest",
  task: "Post the digest",
  timezone: "UTC",
};

function issuesAt(values: ScheduleFormValues, path: string): string[] {
  const result = scheduleFormSchema.safeParse(values);
  return result.success
    ? []
    : result.error.issues
        .filter((i) => i.path.join(".") === path)
        .map((i) => i.message);
}

describe("the schedule form's cadence", () => {
  it.each(["0", "-5", "1.5", "", "2abc"])(
    "refuses an interval of %j without a preview",
    (interval) => {
      const values = { ...base, kind: "minutely" as const, interval };
      expect(buildRRuleParts(values)).toMatchObject({
        summary: "",
        error: "Enter a whole number of 1 or more",
      });
      expect(issuesAt(values, "interval")).toEqual([
        "Enter a whole number of 1 or more",
      ]);
    },
  );

  it("previews a valid interval", () => {
    const values = { ...base, kind: "hourly" as const, interval: "2" };
    expect(buildRRuleParts(values)).toMatchObject({
      summary: "every 2 hours",
      error: null,
    });
    expect(scheduleFormSchema.safeParse(values).success).toBe(true);
  });

  it.each([
    ["FREQ=DAILY;COUNT=3", "COUNT is not supported"],
    ["FREQ=SECONDLY", "FREQ=SECONDLY is not supported"],
    ["FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", "it never fires"],
    ["FREQ=DAILY;UNTIL=20200101T000000Z", "it has no more occurrences"],
    ["FREQ=DAILY;BYHOUR=25", "BYHOUR must be within 0 to 23"],
  ])("refuses the custom rule %s inline without a preview", (rule, reason) => {
    const values = { ...base, kind: "custom" as const, customRRule: rule };
    const parts = buildRRuleParts(values);
    expect(parts.summary).toBe("");
    expect(parts.error).toContain(reason);
    expect(issuesAt(values, "customRRule")).toEqual([parts.error]);
  });

  it("previews a custom rule the server accepts", () => {
    const values = {
      ...base,
      kind: "custom" as const,
      customRRule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
    };
    expect(buildRRuleParts(values).error).toBeNull();
    expect(buildRRuleParts(values).summary).not.toBe("");
  });

  // TEST_SCENARIO: a browser without Temporal cannot run the rule check, so the form must still let the user save and leave the refusal to the save call.
  it("leaves the rule check to the server in a browser without Temporal", () => {
    const temporal = Reflect.get(globalThis, "Temporal");
    Reflect.deleteProperty(globalThis, "Temporal");
    try {
      const values = {
        ...base,
        kind: "custom" as const,
        customRRule: "FREQ=DAILY;COUNT=3",
      };
      expect(buildRRuleParts(values)).toMatchObject({
        body: "FREQ=DAILY;COUNT=3",
        error: null,
      });
    } finally {
      Reflect.set(globalThis, "Temporal", temporal);
    }
  });
});

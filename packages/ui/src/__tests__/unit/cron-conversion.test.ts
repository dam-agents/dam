// TEST_OVERVIEW: a cron schedule converts to the newer RRULE format only when the RRULE in UTC fires at exactly the moments the cron expression fires, and an expression with no exact match names why instead.
import { detectPreset } from "api-server-api";
import { CronExpressionParser } from "cron-parser";
import { describe, expect, it } from "vitest";

import { convertCron } from "../../modules/schedules/lib/cron-conversion.js";
import { nextRRuleRuns } from "../../modules/schedules/lib/rrule-runs.js";

const NOW = new Date("2026-10-15T08:17:00Z");
const RUNS = 40;

function cronFires(cron: string): string[] {
  return CronExpressionParser.parse(cron, { currentDate: NOW, tz: "UTC" })
    .take(RUNS)
    .map((d) => d.toDate().toISOString());
}

function rruleFires(rrule: string, timezone: string): string[] {
  return (nextRRuleRuns(rrule, timezone, NOW, RUNS) ?? []).map((d) =>
    d.toISOString(),
  );
}

function exactRRule(cron: string): string {
  const conversion = convertCron(cron, NOW);
  if (conversion.kind !== "exact") throw new Error(conversion.reason);
  return conversion.rrule;
}

describe("converting a cron expression", () => {
  it.each([
    ["0 9 * * *", "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0"],
    [
      "30 7 * * 1-5",
      "FREQ=DAILY;BYHOUR=7;BYMINUTE=30;BYSECOND=0;BYDAY=MO,TU,WE,TH,FR",
    ],
    ["0 9 * * 0,6", "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0;BYDAY=SA,SU"],
    ["* * * * *", "FREQ=MINUTELY;INTERVAL=1"],
    ["*/15 * * * *", "FREQ=MINUTELY;INTERVAL=15"],
    ["0 * * * *", "FREQ=HOURLY;INTERVAL=1"],
    ["0 */6 * * *", "FREQ=HOURLY;INTERVAL=6"],
    ["5 * * * *", "FREQ=HOURLY;BYMINUTE=5;BYSECOND=0"],
    [
      "*/20 9-17 * * MON-FRI",
      "FREQ=DAILY;BYHOUR=9,10,11,12,13,14,15,16,17;BYMINUTE=0,20,40;BYSECOND=0;BYDAY=MO,TU,WE,TH,FR",
    ],
    [
      "0 8 1,15 * *",
      "FREQ=DAILY;BYHOUR=8;BYMINUTE=0;BYSECOND=0;BYMONTHDAY=1,15",
    ],
    [
      "0 0 1 1,7 *",
      "FREQ=DAILY;BYHOUR=0;BYMINUTE=0;BYSECOND=0;BYMONTHDAY=1;BYMONTH=1,7",
    ],
    ["@daily", "FREQ=DAILY;BYHOUR=0;BYMINUTE=0;BYSECOND=0"],
    ["0 0 9 * * *", "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0"],
  ])("converts %s to %s", (cron, rrule) => {
    expect(exactRRule(cron)).toBe(rrule);
  });

  // TEST_SCENARIO: the conversion keeps a cron schedule's real fire times when the user keeps UTC, which is the dialog's default.
  it.each([
    "0 9 * * *",
    "30 7 * * 1-5",
    "*/15 * * * *",
    "0 */6 * * *",
    "5 * * * *",
    "*/20 9-17 * * MON-FRI",
    "0 8 1,15 * *",
    "0 0 1 1,7 *",
    "0 12 * 2 SUN",
  ])("fires %s at the same moments in UTC", (cron) => {
    expect(rruleFires(exactRRule(cron), "UTC")).toEqual(cronFires(cron));
  });

  // TEST_SCENARIO: a converted daily or interval rule opens in the editor's own presets, so the user edits it with the usual fields and not as raw RRULE text.
  it("opens a daily rule in the editor's daily preset", () => {
    expect(detectPreset(exactRRule("30 7 * * 1-5"))).toEqual({
      kind: "daily",
      hour: 7,
      minute: 30,
      days: [1, 2, 3, 4, 5],
    });
    expect(detectPreset(exactRRule("*/15 * * * *"))).toEqual({
      kind: "minutely",
      interval: 15,
      days: [1, 2, 3, 4, 5, 6, 7],
    });
  });

  it("gives the cron expression's next run times", () => {
    const conversion = convertCron("0 9 * * *", NOW);
    expect(conversion.kind === "exact" && conversion.cronRuns).toEqual([
      new Date("2026-10-15T09:00:00Z"),
      new Date("2026-10-16T09:00:00Z"),
      new Date("2026-10-17T09:00:00Z"),
      new Date("2026-10-18T09:00:00Z"),
      new Date("2026-10-19T09:00:00Z"),
    ]);
  });

  // TEST_SCENARIO: an expression the newer format can't match exactly keeps the delete-and-recreate path, and the dialog tells the user why.
  it.each([
    ["0 9 1 * MON", /both days of the month and days of the week/],
    ["0 0 L * *", /L or W/],
    ["0 9 * * 5L", /L or W/],
    ["0 9 * * 1#2", /# or H/],
    ["H 9 * * *", /# or H/],
    ["30 0 9 * * *", /seconds past the minute/],
    ["not a cron", /can't be read/],
  ])("refuses %s", (cron, reason) => {
    const conversion = convertCron(cron, NOW);
    expect(conversion.kind).toBe("inexact");
    expect(conversion.kind === "inexact" && conversion.reason).toMatch(reason);
  });
});

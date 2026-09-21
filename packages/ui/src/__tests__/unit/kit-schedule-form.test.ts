// TEST_OVERVIEW: what a kit's declared cadence becomes on the setup form. The form speaks only recurrence rules, so a schedule declared as cron must keep its cron until the user changes the cadence, an rrule schedule must keep its declared rule the same way, and the Modified badge must answer against what the kit declared rather than against the form's own stand-in.
import type { StarterKitSchedule } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  kitScheduleFormValues,
  kitScheduleModified,
  overrideFromForm,
} from "../../modules/starter-kits/lib/kit-schedule-form.js";
import { withOverride } from "../../modules/starter-kits/lib/setup.js";

const cronSchedule: StarterKitSchedule = {
  name: "triage",
  task: "Triage the new issues",
  enabled: true,
  cron: "0 9 * * 1-5",
};

const rruleSchedule: StarterKitSchedule = {
  name: "digest",
  task: "Post the daily digest",
  enabled: true,
  rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  timezone: "Europe/Prague",
};

describe("a kit schedule on the setup form", () => {
  it("keeps a declared cron until the cadence is edited", () => {
    const values = kitScheduleFormValues(cronSchedule, undefined);
    const override = overrideFromForm(cronSchedule, values, true);
    expect(override).not.toBeNull();
    expect(override?.timing).toBeUndefined();
    expect(kitScheduleModified(cronSchedule, values, true)).toBe(false);
  });

  it("replaces the cron with the form's rule once the cadence is edited", () => {
    const values = {
      ...kitScheduleFormValues(cronSchedule, undefined),
      kind: "hourly" as const,
      interval: "2",
    };
    const override = overrideFromForm(cronSchedule, values, true);
    expect(override?.timing?.rrule).toContain("HOURLY");
    expect(kitScheduleModified(cronSchedule, values, true)).toBe(true);
  });

  // TEST_SCENARIO: the form's presets cannot express every recurrence rule — an interval, a count and an end date all fall outside them. A kit that declares one must not be silently rewritten into the nearest preset, which would fire every Monday where the kit said every other Monday, with no Modified badge to show it. The rule is carried verbatim instead, so any change to it is one the user made.
  it("carries a rule its presets cannot express, rather than rounding it", () => {
    const everyOtherMonday: StarterKitSchedule = {
      name: "biweekly",
      task: "Post the fortnightly digest",
      enabled: true,
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
      timezone: "Europe/Prague",
    };
    const values = kitScheduleFormValues(everyOtherMonday, undefined);
    expect(values.kind).toBe("custom");
    expect(values.customRRule).toContain("INTERVAL=2");

    const override = overrideFromForm(everyOtherMonday, values, true);
    expect(override?.timing).toBeUndefined();
    expect(kitScheduleModified(everyOtherMonday, values, true)).toBe(false);
  });

  it("keeps a declared rrule as declared until the cadence is edited", () => {
    const values = kitScheduleFormValues(rruleSchedule, undefined);
    const override = overrideFromForm(rruleSchedule, values, true);
    expect(override?.timing).toBeUndefined();
    expect(kitScheduleModified(rruleSchedule, values, true)).toBe(false);
  });

  it("reads a switched-off or retimed schedule as modified", () => {
    const values = kitScheduleFormValues(rruleSchedule, undefined);
    expect(kitScheduleModified(rruleSchedule, values, false)).toBe(true);
    expect(
      kitScheduleModified(rruleSchedule, { ...values, time: "17:30" }, true),
    ).toBe(true);
  });

  // TEST_SCENARIO: the precheck a kit declares is the user's to keep, replace or drop on the setup form. Only "drop" needs to travel as an explicit null — an absent field means the kit's own command, so clearing the box has to say so or the schedule is created with a check the user removed.
  it("keeps, replaces and drops the declared precheck", () => {
    const withPrecheck: StarterKitSchedule = {
      ...cronSchedule,
      precheck: "test -e new",
    };
    const values = kitScheduleFormValues(withPrecheck, undefined);
    expect(values.precheck).toBe("test -e new");
    expect(
      overrideFromForm(withPrecheck, values, true)?.precheck,
    ).toBeUndefined();
    expect(kitScheduleModified(withPrecheck, values, true)).toBe(false);

    const cleared = { ...values, precheck: "  " };
    expect(overrideFromForm(withPrecheck, cleared, true)?.precheck).toBeNull();
    expect(kitScheduleModified(withPrecheck, cleared, true)).toBe(true);

    const replaced = { ...values, precheck: "test -e other" };
    expect(overrideFromForm(withPrecheck, replaced, true)?.precheck).toBe(
      "test -e other",
    );
  });

  // TEST_SCENARIO: a user retimes a schedule, then puts it back to the cadence the kit declared. What the apply carries has to follow them back, or the agent is created on a cadence the user withdrew, with the form showing the kit's own time.
  it("drops a stored cadence when the user reverts to the kit's own", () => {
    const values = kitScheduleFormValues(rruleSchedule, undefined);
    const retimed = overrideFromForm(
      rruleSchedule,
      { ...values, time: "17:30" },
      true,
    );
    const stored = withOverride([], rruleSchedule.name, retimed!);
    expect(stored[0]!.timing).toBeDefined();

    const reverted = overrideFromForm(rruleSchedule, values, true);
    expect(reverted!.timing).toBeUndefined();
    const after = withOverride(stored, rruleSchedule.name, reverted!);
    expect(after).toHaveLength(1);
    expect(after[0]!.timing).toBeUndefined();
  });
});

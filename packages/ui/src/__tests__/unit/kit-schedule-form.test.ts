// TEST_OVERVIEW: what a kit's declared cadence becomes on the setup form. The form speaks only recurrence rules, so a schedule declared as cron must keep its cron until the user changes the cadence, an rrule schedule must round-trip without reading as modified, and the Modified badge must answer against what the kit declared rather than against the form's own stand-in.
import type { StarterKitSchedule } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  kitScheduleFormValues,
  kitScheduleModified,
  overrideFromForm,
} from "../../modules/starter-kits/lib/kit-schedule-form.js";

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

  it("round-trips a declared rrule without reading as modified", () => {
    const values = kitScheduleFormValues(rruleSchedule, undefined);
    const override = overrideFromForm(rruleSchedule, values, true);
    expect(override?.timing?.timezone).toBe("Europe/Prague");
    expect(kitScheduleModified(rruleSchedule, values, true)).toBe(false);
  });

  it("reads a switched-off or retimed schedule as modified", () => {
    const values = kitScheduleFormValues(rruleSchedule, undefined);
    expect(kitScheduleModified(rruleSchedule, values, false)).toBe(true);
    expect(
      kitScheduleModified(rruleSchedule, { ...values, time: "17:30" }, true),
    ).toBe(true);
  });
});

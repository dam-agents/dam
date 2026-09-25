import { describe, it, expect } from "vitest";
import type { ScheduleSpec } from "api-server-api";
import {
  nextFireAt,
  triggerExpiry,
  validateHasVisibleOccurrence,
  validateRRule,
} from "../../modules/schedules/domain/recurrences.js";

function rruleSpec(
  rrule: string,
  timezone: string,
  quietHours?: { startTime: string; endTime: string; enabled: boolean }[],
): ScheduleSpec {
  return {
    version: "platform.ai/v1",
    type: "rrule",
    rrule,
    timezone,
    quietHours,
    enabled: true,
    createdBy: "user",
  };
}

describe("nextFireAt (rrule)", () => {
  it("fires at the wall-clock time in the schedule's timezone, not UTC", () => {
    const spec = rruleSpec(
      "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0",
      "Europe/Prague",
    );
    const next = nextFireAt(spec, new Date("2026-06-11T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-06-11T07:00:00.000Z");
  });

  it("tracks the timezone's winter offset", () => {
    const spec = rruleSpec(
      "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0",
      "Europe/Prague",
    );
    const next = nextFireAt(spec, new Date("2026-01-15T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("does not skip a same-day occurrence in zones behind UTC", () => {
    const spec = rruleSpec(
      "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0",
      "America/New_York",
    );
    const next = nextFireAt(spec, new Date("2026-06-11T11:00:00Z"));
    expect(next?.toISOString()).toBe("2026-06-11T13:00:00.000Z");
  });

  it("does not inherit seconds from the evaluation instant", () => {
    const spec = rruleSpec("FREQ=DAILY;BYHOUR=9;BYMINUTE=0", "Europe/Prague");
    const next = nextFireAt(spec, new Date("2026-06-11T00:00:59Z"));
    expect(next?.toISOString()).toBe("2026-06-11T07:00:00.000Z");
  });

  it("rolls to the next day once today's occurrence has passed locally", () => {
    const spec = rruleSpec(
      "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0",
      "Europe/Prague",
    );
    const next = nextFireAt(spec, new Date("2026-06-11T07:30:00Z"));
    expect(next?.toISOString()).toBe("2026-06-12T07:00:00.000Z");
  });

  it("evaluates quiet hours against the schedule's local clock", () => {
    const spec = rruleSpec("FREQ=HOURLY", "Europe/Prague", [
      { startTime: "22:00", endTime: "06:00", enabled: true },
    ]);
    const next = nextFireAt(spec, new Date("2026-06-11T19:30:00Z"));
    expect(next?.toISOString()).toBe("2026-06-12T04:30:00.000Z");
  });

  it("ignores disabled quiet windows", () => {
    const spec = rruleSpec("FREQ=HOURLY", "Europe/Prague", [
      { startTime: "22:00", endTime: "06:00", enabled: false },
    ]);
    const next = nextFireAt(spec, new Date("2026-06-11T19:30:00Z"));
    expect(next?.toISOString()).toBe("2026-06-11T20:30:00.000Z");
  });

  it("returns null when quiet hours suppress every occurrence", () => {
    const spec = rruleSpec(
      "FREQ=DAILY;BYHOUR=23;BYMINUTE=0;BYSECOND=0;COUNT=3",
      "Europe/Prague",
      [{ startTime: "22:00", endTime: "06:00", enabled: true }],
    );
    expect(nextFireAt(spec, new Date("2026-06-11T00:00:00Z"))).toBeNull();
  });

  it("keeps UTC schedules unchanged", () => {
    const spec = rruleSpec("FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0", "UTC");
    const next = nextFireAt(spec, new Date("2026-06-11T08:00:00Z"));
    expect(next?.toISOString()).toBe("2026-06-11T09:00:00.000Z");
  });

  it("resolves wall times erased by spring-forward to just past the jump", () => {
    const spec = rruleSpec(
      "FREQ=DAILY;BYHOUR=2;BYMINUTE=30;BYSECOND=0",
      "Europe/Prague",
    );
    const next = nextFireAt(spec, new Date("2026-03-29T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
});

describe("nextFireAt (sub-daily rrule pinned to hours or minutes)", () => {
  const QUARTER_HOURS_WORKDAY =
    "FREQ=MINUTELY;INTERVAL=15;BYDAY=MO,TU,WE,TH,FR;BYHOUR=7,8,9,10,11,12,13,14,15,16,17,18;BYMINUTE=0,15,30,45";

  it("lands on the pinned minutes when evaluated off the quarter hour", () => {
    const spec = rruleSpec(QUARTER_HOURS_WORKDAY, "Europe/Prague");
    const next = nextFireAt(spec, new Date("2026-09-25T11:47:00Z"));
    expect(next?.toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });

  it("steps an hourly interval from midnight, not from the evaluation hour", () => {
    const spec = rruleSpec("FREQ=HOURLY;INTERVAL=2;BYHOUR=8,10,12", "UTC");
    const next = nextFireAt(spec, new Date("2026-09-25T09:13:00Z"));
    expect(next?.toISOString()).toBe("2026-09-25T10:00:00.000Z");
  });

  it.each([
    "FREQ=MINUTELY;INTERVAL=15;BYMINUTE=7",
    "FREQ=HOURLY;INTERVAL=2;BYHOUR=9",
  ])("returns null for %s, whose steps never reach its pins", (rrule) => {
    expect(nextFireAt(rruleSpec(rrule, "UTC"), new Date())).toBeNull();
  });
});

describe("validateRRule", () => {
  it("rejects a sub-daily interval that never reaches its pins", () => {
    expect(() => validateRRule("FREQ=MINUTELY;INTERVAL=15;BYMINUTE=7")).toThrow(
      /never fires/,
    );
  });

  it("accepts a quarter-hour rule pinned to quarter-hour minutes", () => {
    expect(() =>
      validateRRule("FREQ=MINUTELY;INTERVAL=15;BYHOUR=9;BYMINUTE=0,15,30,45"),
    ).not.toThrow();
  });

  it("checks quiet hours for a pinned quarter-hour rule without hanging", () => {
    expect(() =>
      validateHasVisibleOccurrence(
        "FREQ=MINUTELY;INTERVAL=15;BYHOUR=9,10;BYMINUTE=0,15,30,45",
        [{ startTime: "18:00", endTime: "06:00", enabled: true }],
      ),
    ).not.toThrow();
  });
});

describe("nextFireAt (cron)", () => {
  it("stays UTC for legacy cron schedules", () => {
    const spec: ScheduleSpec = {
      version: "platform.ai/v1",
      type: "cron",
      cron: "0 9 * * *",
      enabled: true,
      createdBy: "user",
    };
    const next = nextFireAt(spec, new Date("2026-06-11T08:00:00Z"));
    expect(next?.toISOString()).toBe("2026-06-11T09:00:00.000Z");
  });
});

describe("triggerExpiry", () => {
  /** TEST_SCENARIO: the next occurrence supersedes a fire still waiting to be
   *  delivered, so it bounds the event's life ahead of the TTL. */
  it("expires at the next occurrence when it lands before the TTL", () => {
    const firedAt = new Date("2026-09-02T10:00:00Z");
    const next = new Date("2026-09-02T10:05:00Z");
    expect(triggerExpiry(firedAt, next, 900).toISOString()).toBe(
      "2026-09-02T10:05:00.000Z",
    );
  });

  /** TEST_SCENARIO: a sparse schedule falls back to the TTL, and so does one
   *  with no further occurrence at all. */
  it("expires at the TTL when the next occurrence is further out", () => {
    const firedAt = new Date("2026-09-02T10:00:00Z");
    expect(
      triggerExpiry(
        firedAt,
        new Date("2026-09-03T10:00:00Z"),
        900,
      ).toISOString(),
    ).toBe("2026-09-02T10:15:00.000Z");
    expect(triggerExpiry(firedAt, null, 900).toISOString()).toBe(
      "2026-09-02T10:15:00.000Z",
    );
  });

  /** TEST_SCENARIO: nextFireAt evaluates the rule from the fire instant
   *  truncated to the minute, so a rule carrying seconds can answer with an
   *  occurrence that has already passed. Anchoring expiry on it would stamp the
   *  event expired at birth and silently drop the fire, so the TTL takes over. */
  it("falls back to the TTL when the next occurrence already passed", () => {
    const firedAt = new Date("2026-09-02T10:00:30Z");
    const next = nextFireAt(
      rruleSpec("FREQ=HOURLY;BYSECOND=15", "UTC"),
      firedAt,
    );
    expect(next?.toISOString()).toBe("2026-09-02T10:00:15.000Z");
    expect(triggerExpiry(firedAt, next, 900).toISOString()).toBe(
      "2026-09-02T10:15:30.000Z",
    );
  });
});

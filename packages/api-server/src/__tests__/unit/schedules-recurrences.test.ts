import { describe, it, expect } from "vitest";
import { hasVisibleOccurrence } from "api-server-api";
import type { ScheduleSpec } from "api-server-api";
import {
  nextFire,
  nextFireAt,
  triggerExpiry,
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
    expect(next?.toISOString()).toBe("2026-06-12T04:00:00.000Z");
  });

  it("ignores disabled quiet windows", () => {
    const spec = rruleSpec("FREQ=HOURLY", "Europe/Prague", [
      { startTime: "22:00", endTime: "06:00", enabled: false },
    ]);
    const next = nextFireAt(spec, new Date("2026-06-11T19:30:00Z"));
    expect(next?.toISOString()).toBe("2026-06-11T20:00:00.000Z");
  });

  it("returns null when quiet hours suppress every occurrence", () => {
    const spec = rruleSpec(
      "FREQ=DAILY;BYHOUR=23;BYMINUTE=0;BYSECOND=0",
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

  // TEST_SCENARIO: RFC 5545 ignores an occurrence whose local time does not exist, so a 02:30 schedule skips the night the clocks spring forward instead of firing at 03:30.
  it("skips a wall time erased by spring-forward", () => {
    const spec = rruleSpec(
      "FREQ=DAILY;BYHOUR=2;BYMINUTE=30;BYSECOND=0",
      "Europe/Prague",
    );
    const next = nextFireAt(spec, new Date("2026-03-29T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-03-30T00:30:00.000Z");
  });

  it("steps an unpinned rule from the hour, not from the evaluation instant", () => {
    const spec = rruleSpec("FREQ=MINUTELY;INTERVAL=15", "UTC");
    const next = nextFireAt(spec, new Date("2026-09-25T11:47:00Z"));
    expect(next?.toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });
});

function stepFromAnchor(rrule: string, from: Date): Date | null {
  const fields = Object.fromEntries(
    rrule.split(";").map((part) => part.split("=")),
  );
  const list = (key: string) => fields[key]?.split(",").map(Number);
  const hourly = fields.FREQ === "HOURLY";
  const step = Number(fields.INTERVAL ?? 1) * (hourly ? 60 : 1);
  const minutes = list("BYMINUTE");
  const hours = list("BYHOUR");
  const anchor = Date.UTC(2001, 0, 1) / 60_000;
  const first = Math.floor((from.getTime() / 60_000 - anchor) / step);
  for (let k = first; k < first + 200_000; k++) {
    const period = anchor + k * step;
    for (const offset of hourly ? (minutes ?? [0]) : [0]) {
      const at = new Date((period + offset) * 60_000);
      if (at <= from) continue;
      if (!hourly && minutes && !minutes.includes(at.getUTCMinutes())) continue;
      if (hours && !hours.includes(at.getUTCHours())) continue;
      return at;
    }
  }
  return null;
}

// TEST_SCENARIO: every rule counts its steps from the same fixed start, so a pinned sub-daily rule lands on its pins from any evaluation instant, and a rule that can never fire answers null at once instead of blocking the event loop.
describe("nextFireAt (rrule counted from a fixed start)", () => {
  const QUARTER_HOURS_WORKDAY =
    "FREQ=MINUTELY;INTERVAL=15;BYDAY=MO,TU,WE,TH,FR;BYHOUR=7,8,9,10,11,12,13,14,15,16,17,18;BYMINUTE=0,15,30,45";

  it("lands on the pinned minutes when evaluated off the quarter hour", () => {
    const spec = rruleSpec(QUARTER_HOURS_WORKDAY, "Europe/Prague");
    const next = nextFireAt(spec, new Date("2026-09-25T11:47:00Z"));
    expect(next?.toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });

  it("skips the weekend to the first pinned slot on Monday", () => {
    const spec = rruleSpec(QUARTER_HOURS_WORKDAY, "Europe/Prague");
    const next = nextFireAt(spec, new Date("2026-09-26T10:00:00Z"));
    expect(next?.toISOString()).toBe("2026-09-28T05:00:00.000Z");
  });

  it.each([
    ["FREQ=HOURLY;INTERVAL=3;BYHOUR=9", "2026-09-25T10:00:00Z"],
    ["FREQ=HOURLY;INTERVAL=5;BYHOUR=10;BYMINUTE=15,45", "2026-09-26T10:20:00Z"],
    ["FREQ=HOURLY;INTERVAL=7;BYMINUTE=30", "2026-09-25T11:47:00Z"],
    ["FREQ=MINUTELY;INTERVAL=7;BYMINUTE=0", "2026-09-25T11:47:00Z"],
    ["FREQ=MINUTELY;INTERVAL=25;BYHOUR=9,10", "2026-09-25T11:47:00Z"],
    ["FREQ=MINUTELY;INTERVAL=90;BYHOUR=3,9,15", "2026-09-25T11:47:00Z"],
  ])(
    "gives %s the occurrence that stepping from the fixed start gives, from %s",
    (rrule, from) => {
      const expected = stepFromAnchor(rrule, new Date(from));
      expect(expected).not.toBeNull();
      expect(nextFireAt(rruleSpec(rrule, "UTC"), new Date(from))).toEqual(
        expected,
      );
    },
  );

  it("finds a sparse but real date", () => {
    const spec = rruleSpec("FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=29", "UTC");
    const next = nextFireAt(spec, new Date("2026-09-25T11:47:00Z"));
    expect(next?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("answers the same occurrence from any evaluation instant before it", () => {
    const spec = rruleSpec("FREQ=HOURLY;INTERVAL=5;BYHOUR=10", "UTC");
    const first = nextFireAt(spec, new Date("2026-09-25T11:00:00Z"))!;
    const justBefore = new Date(first.getTime() - 60_000);
    expect(nextFireAt(spec, justBefore)).toEqual(first);
    const second = nextFireAt(spec, first)!;
    expect(second.getTime() - first.getTime()).toBe(5 * 24 * 3600_000);
  });

  it.each([
    "FREQ=HOURLY;INTERVAL=2;BYHOUR=9",
    "FREQ=HOURLY;BYSETPOS=3",
    "FREQ=DAILY;BYHOUR=9,10;BYSETPOS=3",
    "FREQ=MINUTELY;INTERVAL=15;BYMINUTE=0;BYMONTH=2;BYMONTHDAY=30",
  ])("answers null quickly for %s, which never fires", (rrule) => {
    const started = Date.now();
    const quiet = [{ startTime: "02:00", endTime: "03:00", enabled: true }];
    expect(
      nextFireAt(
        rruleSpec(rrule, "UTC", quiet),
        new Date("2026-09-25T11:47:00Z"),
      ),
    ).toBeNull();
    expect(hasVisibleOccurrence(rrule, "UTC", quiet)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

// TEST_SCENARIO: the search runs on the api-server's event loop, so rules that once took seconds to answer, quiet hours that cover a sparse rule among them, now answer within a fraction of a second.
describe("nextFire (bounded work)", () => {
  const allDay = [{ startTime: "00:00", endTime: "23:59", enabled: true }];
  it.each([
    ["FREQ=MONTHLY;INTERVAL=3;BYWEEKNO=2", "Europe/Prague", allDay],
    ["FREQ=YEARLY;BYSETPOS=400;BYDAY=MO;BYHOUR=1,2", "America/New_York", []],
    [
      "FREQ=HOURLY;INTERVAL=10000;BYMONTH=2;BYMINUTE=1;BYSETPOS=366",
      "Australia/Lord_Howe",
      [],
    ],
  ])("answers %s in %s quickly", (rrule, timezone, quiet) => {
    const started = Date.now();
    nextFire(
      rruleSpec(rrule, timezone, quiet),
      new Date("2026-10-01T08:47:13Z"),
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("resumes after the quiet window instead of stepping through it", () => {
    const spec = rruleSpec("FREQ=MINUTELY", "UTC", allDay);
    expect(nextFireAt(spec, new Date("2026-10-01T08:47:13Z"))).toEqual(
      new Date("2026-10-01T23:59:00Z"),
    );
  });
});

// TEST_SCENARIO: a rule saved before its kind was rejected must stop rather than keep firing, so nextFireAt refuses exactly what the save call refuses.
it.each(["FREQ=SECONDLY", "FREQ=HOURLY;COUNT=5"])(
  "stops a stored %s rule",
  (rrule) => {
    expect(
      nextFireAt(rruleSpec(rrule, "UTC"), new Date("2026-09-25T11:47:00Z")),
    ).toBeNull();
  },
);

describe("nextFire", () => {
  it.each([
    ["FREQ=HOURLY;BYSETPOS=3", "it never fires"],
    ["FREQ=DAILY;UNTIL=20200101T000000Z", "it has no more occurrences"],
    ["FREQ=DAILY;COUNT=3", "COUNT is not supported"],
  ])("names why %s has no next run", (rrule, reason) => {
    const next = nextFire(
      rruleSpec(rrule, "UTC"),
      new Date("2026-09-25T11:47:00Z"),
    );
    expect(next).toEqual({
      kind: "stopped",
      reason: expect.stringContaining(reason),
    });
  });

  it("names quiet hours when they cover every occurrence", () => {
    const next = nextFire(
      rruleSpec("FREQ=DAILY;BYHOUR=23;BYMINUTE=0", "Europe/Prague", [
        { startTime: "22:00", endTime: "06:00", enabled: true },
      ]),
      new Date("2026-09-25T11:47:00Z"),
    );
    expect(next).toEqual({
      kind: "stopped",
      reason: "quiet hours cover every remaining occurrence",
    });
  });

  // TEST_SCENARIO: an UNTIL without a UTC designator is valid RRULE text the old engine fired, so it is read in the schedule's timezone instead of refused.
  it("reads a floating UNTIL in the schedule's timezone", () => {
    const spec = rruleSpec(
      "FREQ=DAILY;BYHOUR=9;UNTIL=20260926T090000",
      "Europe/Prague",
    );
    expect(nextFireAt(spec, new Date("2026-09-25T11:47:00Z"))).toEqual(
      new Date("2026-09-26T07:00:00Z"),
    );
    expect(nextFireAt(spec, new Date("2026-09-26T07:00:00Z"))).toBeNull();
  });
});

describe("validateRRule", () => {
  it.each([
    "FREQ=MINUTELY;INTERVAL=15;BYDAY=MO,TU,WE,TH,FR;BYHOUR=7,8,9;BYMINUTE=0,15,30,45",
    "FREQ=MINUTELY;INTERVAL=7;BYMINUTE=0",
    "FREQ=MINUTELY;INTERVAL=7;BYDAY=MO,WE",
    "FREQ=HOURLY;BYMINUTE=0,30;BYSETPOS=1",
    "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
  ])("accepts %s", (rrule) => {
    expect(() => validateRRule(rrule, "UTC", [])).not.toThrow();
  });

  it.each([
    ["FREQ=HOURLY;INTERVAL=2;BYHOUR=9", /it never fires/],
    ["FREQ=HOURLY;BYSETPOS=3", /it never fires/],
    ["FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30", /it never fires/],
    ["FREQ=DAILY;UNTIL=20200101T000000Z", /it has no more occurrences/],
    ["FREQ=SECONDLY", /FREQ=SECONDLY is not supported/],
    ["FREQ=DAILY;COUNT=3", /COUNT is not supported/],
    ["FREQ=MINUTELY;INTERVAL=10001", /INTERVAL above 10000 is not supported/],
    [
      `FREQ=MONTHLY;BYMONTHDAY=1;BYSETPOS=${"1,".repeat(500)}1`,
      /longer than 1000 characters is not supported/,
    ],
  ])("rejects %s", (rrule, message) => {
    expect(() => validateRRule(rrule, "UTC", [])).toThrow(message);
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

  /** TEST_SCENARIO: a next occurrence that has already passed must not stamp
   *  the event expired at birth and silently drop the fire, so the TTL takes
   *  over. */
  it("falls back to the TTL when the next occurrence already passed", () => {
    const firedAt = new Date("2026-09-02T10:00:30Z");
    const next = new Date("2026-09-02T10:00:15Z");
    expect(triggerExpiry(firedAt, next, 900).toISOString()).toBe(
      "2026-09-02T10:15:30.000Z",
    );
  });
});

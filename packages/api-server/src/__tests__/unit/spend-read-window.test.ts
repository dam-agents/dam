// TEST_OVERVIEW: a spend read with an exact window sums the call rows while the window starts within their 30 days, and otherwise widens to whole UTC days; nothing before the measuring start counts.
import { describe, expect, it } from "vitest";

import { readRangeOf } from "../../modules/spend/domain/read-window.js";

const now = new Date("2026-10-22T16:30:00.000Z");
const measuredFrom = new Date("2026-01-01T00:00:00.000Z");
const detailSince = new Date("2026-01-01T00:00:00.000Z");

describe("spend read window", () => {
  // TEST_SCENARIO: the last two hours read the call rows over exactly that window.
  it("reads a recent window in hours", () => {
    expect(
      readRangeOf(
        { fromAt: "2026-10-22T14:30:00.000Z", toAt: now.toISOString() },
        now,
        measuredFrom,
        detailSince,
      ),
    ).toEqual({
      from: "2026-10-22",
      to: "2026-10-22",
      at: { fromAt: new Date("2026-10-22T14:30:00.000Z"), toAt: now },
      window: {
        granularity: "hour",
        fromAt: "2026-10-22T14:30:00.000Z",
        toAt: "2026-10-22T16:30:00.000Z",
      },
    });
  });

  // TEST_SCENARIO: a window that starts before the call rows' 30 days widens to the UTC days it touches and reads no call rows.
  it("widens an old window to whole days", () => {
    const range = readRangeOf(
      { fromAt: "2026-09-01T10:00:00.000Z", toAt: "2026-09-02T00:00:00.000Z" },
      now,
      measuredFrom,
      detailSince,
    );
    expect(range.at).toBeUndefined();
    expect(range).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-01",
      window: {
        granularity: "day",
        fromAt: "2026-09-01T00:00:00.000Z",
        toAt: "2026-09-02T00:00:00.000Z",
      },
    });
  });

  // TEST_SCENARIO: a recent window that starts before the first call row with a call's detail widens to whole days, so the rows written before that detail existed never count as empty calls.
  it("widens a window that starts before the call rows carry detail", () => {
    const range = readRangeOf(
      { fromAt: "2026-10-22T10:00:00.000Z", toAt: now.toISOString() },
      now,
      measuredFrom,
      new Date("2026-10-22T12:00:00.000Z"),
    );
    expect(range.at).toBeUndefined();
    expect(range.window.granularity).toBe("day");
  });

  // TEST_SCENARIO: the longest window in hours, 30 days back from now, still reads hours.
  it("reads the full retention in hours", () => {
    const range = readRangeOf(
      {
        fromAt: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
        toAt: now.toISOString(),
      },
      new Date(now.getTime() + 5),
      measuredFrom,
      detailSince,
    );
    expect(range.window.granularity).toBe("hour");
  });

  // TEST_SCENARIO: a window that starts before the measuring start begins at it, so a start long ago still reads hours when measuring began recently.
  it("starts no earlier than the measuring start", () => {
    const range = readRangeOf(
      { fromAt: "2026-08-01T00:00:00.000Z", toAt: now.toISOString() },
      now,
      new Date("2026-10-19T00:00:00.000Z"),
      detailSince,
    );
    expect(range.window).toEqual({
      granularity: "hour",
      fromAt: "2026-10-19T00:00:00.000Z",
      toAt: "2026-10-22T16:30:00.000Z",
    });
  });
});

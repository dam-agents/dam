import { describe, expect, it } from "vitest";
import {
  composeSessionList,
  type SessionMetaLike,
} from "../../modules/acp/domain/session-list.js";

// TEST_OVERVIEW: the one session-list composition both read paths share — union, tombstones, terminal default, schema narrowing.

function entry(meta: SessionMetaLike["meta"]): SessionMetaLike {
  return { meta, createdAt: "2026-08-27T10:00:00.000Z" };
}

const notTombstoned = () => false;
const notRunning = () => false;

describe("composeSessionList", () => {
  it("enriches a harness session from its store entry", () => {
    const out = composeSessionList(
      [{ sessionId: "s1", title: "t", updatedAt: "2026-08-27T11:00:00.000Z" }],
      { s1: entry({ mode: "chat", type: "schedule_cron", scheduleId: "sch" }) },
      { isTombstoned: notTombstoned, isRunning: () => true },
    );
    expect(out).toEqual([
      expect.objectContaining({
        sessionId: "s1",
        mode: "chat",
        type: "schedule_cron",
        scheduleId: "sch",
        title: "t",
        running: true,
      }),
    ]);
  });

  it("lists a store-only session with a null title", () => {
    const out = composeSessionList(
      [],
      { fresh: entry({ mode: "chat", type: "schedule_cron" }) },
      { isTombstoned: notTombstoned, isRunning: notRunning },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sessionId: "fresh", title: null });
  });

  it("defaults a harness-only session to a terminal one", () => {
    const out = composeSessionList(
      [{ sessionId: "tui" }],
      {},
      { isTombstoned: notTombstoned, isRunning: notRunning },
    );
    expect(out[0]).toMatchObject({ mode: "terminal", type: "regular" });
  });

  it("filters tombstoned sessions from both sources", () => {
    const out = composeSessionList(
      [{ sessionId: "gone" }],
      { gone: entry({}), alsoGone: entry({}) },
      { isTombstoned: () => true, isRunning: notRunning },
    );
    expect(out).toEqual([]);
  });

  it("falls back on an unknown stored mode or type", () => {
    const out = composeSessionList(
      [],
      { odd: entry({ mode: "vr", type: "channel_myspace" }) },
      { isTombstoned: notTombstoned, isRunning: notRunning },
    );
    expect(out[0]).toMatchObject({ mode: "chat", type: "regular" });
  });
});

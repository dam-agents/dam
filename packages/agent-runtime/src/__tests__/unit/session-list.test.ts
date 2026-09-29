import { describe, expect, it } from "vitest";
import type { PodSession, SessionListQuery } from "agent-runtime-api";
import {
  composeSessionList,
  pageSessions,
  type SessionMetaLike,
} from "../../modules/acp/domain/session-list.js";

// TEST_OVERVIEW: the one session-list composition both read paths share — union, tombstones, terminal default, schema narrowing — and the filtered, newest-first pages cut from it.

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

function session(
  sessionId: string,
  updatedAt: string,
  extra: Partial<PodSession> = {},
): PodSession {
  return {
    sessionId,
    mode: "chat",
    type: "regular",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt,
    title: null,
    scheduleId: null,
    threadTs: null,
    seenAt: null,
    runStartedAt: null,
    runTotalMs: null,
    runCount: null,
    running: false,
    ...extra,
  };
}

describe("pageSessions", () => {
  // TEST_SCENARIO: Several sessions share one activity time, so a cursor on time alone would skip or repeat them; following nextCursor must return every session once, newest first.
  it("walks every session exactly once across pages, even on tied activity times", () => {
    const tie = "2026-08-27T12:00:00.000Z";
    const all = [
      session("c", tie),
      session("old", "2026-08-27T09:00:00.000Z"),
      session("a", tie),
      session("new", "2026-08-27T13:00:00.000Z"),
      session("b", tie),
    ];
    const seen: string[] = [];
    let query: SessionListQuery = { limit: 2 };
    for (;;) {
      const page = pageSessions(all, query);
      seen.push(...page.sessions.map((s) => s.sessionId));
      if (!page.nextCursor) break;
      query = { limit: 2, after: page.nextCursor };
    }
    expect(seen).toEqual(["new", "a", "b", "c", "old"]);
  });

  // TEST_SCENARIO: The filter runs before the cut, so a page is full of matching sessions rather than a page of everything with most rows hidden.
  it("filters by category and schedule before cutting the page", () => {
    const all = [
      session("chat", "2026-08-27T15:00:00.000Z"),
      session("term", "2026-08-27T14:00:00.000Z", {
        mode: "terminal",
        type: "schedule_cron",
        scheduleId: "s1",
      }),
      session("other", "2026-08-27T13:00:00.000Z", {
        type: "schedule_cron",
        scheduleId: "s2",
      }),
      session("run", "2026-08-27T12:00:00.000Z", {
        type: "schedule_cron",
        scheduleId: "s1",
      }),
    ];
    const page = pageSessions(all, {
      categories: ["scheduled"],
      scheduleId: "s1",
      limit: 1,
    });
    expect(page.sessions.map((s) => s.sessionId)).toEqual(["run"]);
    expect(page.nextCursor).toBeNull();
  });
});

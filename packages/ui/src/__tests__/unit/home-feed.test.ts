import type { AttentionItem } from "api-server-api";
import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  channelTypeOfSession,
  defaultActivityFilters,
  isFiltered,
} from "../../modules/home/lib/activity-filter.js";
import {
  filterActivitySessions,
  toActivitySessions,
} from "../../modules/home/lib/activity-sessions.js";
import {
  type FeedItem,
  sortFeedItems,
} from "../../modules/home/lib/feed-item.js";

// TEST_OVERVIEW: the activity ordering and filtering rules, kept pure so they can be pinned here. The sidebar Activity filters sessions by the channel they arrived through and by their state, so both halves are covered.

function session(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    sessionId: "s-1",
    agentId: "a-1",
    type: SessionType.Regular,
    mode: SessionMode.Chat,
    title: null,
    scheduleId: null,
    createdAt: "2026-08-19T10:00:00Z",
    activityAt: null,
    seenAt: null,
    working: false,
    ...overrides,
  };
}

function unread(
  id: string,
  at: string | null,
  type: SessionType = SessionType.Regular,
): FeedItem {
  return {
    kind: "unread",
    id,
    agentId: "a-1",
    at,
    session: session({
      sessionId: id,
      type,
      seenAt: "2026-08-19T07:00:00Z",
      activityAt: at ?? "2026-08-19T10:00:00Z",
    }),
  };
}

describe("sortFeedItems", () => {
  it("puts the newest first", () => {
    const sorted = sortFeedItems([
      unread("old", "2026-08-19T10:00:00Z"),
      unread("new", "2026-08-19T12:00:00Z"),
      unread("mid", "2026-08-19T11:00:00Z"),
    ]);

    expect(sorted.map((i) => i.id)).toEqual(["new", "mid", "old"]);
  });

  // TEST_SCENARIO: undated work is happening now, so it leads rather than being dropped.
  it("leads with an item that has no timestamp", () => {
    const sorted = sortFeedItems([
      unread("dated", "2026-08-19T12:00:00Z"),
      unread("undated", null),
    ]);

    expect(sorted.map((i) => i.id)).toEqual(["undated", "dated"]);
  });

  it("breaks a tie on id so the list does not reshuffle between refetches", () => {
    const at = "2026-08-19T12:00:00Z";
    const first = sortFeedItems([unread("b", at), unread("a", at)]);
    const again = sortFeedItems([unread("a", at), unread("b", at)]);

    expect(first.map((i) => i.id)).toEqual(["a", "b"]);
    expect(again.map((i) => i.id)).toEqual(first.map((i) => i.id));
  });
});

describe("the activity filters", () => {
  const unreadSession = (
    sessionId: string,
    activityAt: string,
    type: SessionType = SessionType.Regular,
  ) => session({ sessionId, type, activityAt, seenAt: "2026-08-19T07:00:00Z" });
  const running = new Set(["a-1"]);
  const items = toActivitySessions(
    [
      session({
        sessionId: "run",
        working: true,
        activityAt: "2026-08-19T11:00:00Z",
        seenAt: "2026-08-19T11:30:00Z",
      }),
      unreadSession("chat", "2026-08-19T10:00:00Z"),
      unreadSession("sched", "2026-08-19T09:00:00Z", SessionType.ScheduleCron),
      unreadSession("slack", "2026-08-19T08:00:00Z", SessionType.ChannelSlack),
      session({
        sessionId: "seen",
        activityAt: "2026-08-19T07:00:00Z",
        seenAt: "2026-08-19T07:30:00Z",
      }),
    ],
    running,
  );
  const ids = (list: readonly { session: AttentionItem }[]) =>
    list.map((i) => i.session.sessionId).sort();

  // TEST_SCENARIO: a session is filed by how it arrived — a schedule fire, a Slack thread, or a plain chat — because that is what a user filters on.
  it("files each session under the channel it arrived through", () => {
    const byId = Object.fromEntries(
      items.map((item) => [
        item.session.sessionId,
        channelTypeOfSession(item.session),
      ]),
    );
    expect(byId["sched"]).toBe("schedule");
    expect(byId["slack"]).toBe("slack");
    expect(byId["chat"]).toBe("chat");
  });

  // TEST_SCENARIO: unchecking a type hides only that type, and the default set hides nothing.
  it("keeps only the checked channel types", () => {
    const base = defaultActivityFilters();
    expect(isFiltered(base)).toBe(false);
    expect(filterActivitySessions(items, base)).toHaveLength(items.length);

    const onlySchedule = {
      ...base,
      channelTypes: new Set(["schedule" as const]),
    };
    expect(isFiltered(onlySchedule)).toBe(true);
    expect(ids(filterActivitySessions(items, onlySchedule))).toEqual(["sched"]);
  });

  // TEST_SCENARIO: the state filter is separate from the type filter, and every state keeps different sessions. "Unread" keeps only sessions with activity newer than the seen watermark, so a session the user already read is not in the unread pile, and no two states may resolve to the same list, which is how a filter stops meaning anything.
  it("gives each state its own sessions", () => {
    const base = defaultActivityFilters();
    const byState = (state: "any" | "in-progress" | "unread") =>
      ids(filterActivitySessions(items, { ...base, state }));

    expect(byState("in-progress")).toEqual(["run"]);
    expect(byState("unread")).toEqual(["chat", "sched", "slack"]);
    expect(byState("any")).toHaveLength(items.length);
    expect(byState("unread")).not.toEqual(byState("in-progress"));
  });
});

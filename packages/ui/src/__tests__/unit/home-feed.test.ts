import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it } from "vitest";

import { bucketOf } from "../../modules/home/lib/feed-buckets.js";
import {
  ALL_CATEGORIES,
  ALL_STATES,
  emptyStateFor,
  type FeedState,
  feedStats,
  filterFeed,
} from "../../modules/home/lib/feed-filter.js";
import {
  type FeedItem,
  sortFeedItems,
} from "../../modules/home/lib/feed-item.js";
import type { SessionCategory } from "../../modules/sessions/lib/session-category.js";
import type { SessionView } from "../../types.js";

function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: "s-1",
    agentId: "a-1",
    type: SessionType.Regular,
    mode: SessionMode.Chat,
    createdAt: "2026-08-19T10:00:00Z",
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
    session: session({ sessionId: id, type }),
  };
}

function inProgress(
  id: string,
  at: string | null,
  type: SessionType = SessionType.Regular,
): FeedItem {
  return {
    kind: "in-progress",
    id,
    agentId: "a-1",
    at,
    session: session({ sessionId: id, type, running: true }),
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

describe("filterFeed", () => {
  const items: FeedItem[] = [
    inProgress("run", "2026-08-19T12:00:00Z"),
    unread("chat", "2026-08-19T10:00:00Z"),
    unread("sched", "2026-08-19T09:00:00Z", SessionType.ScheduleCron),
    unread("slack", "2026-08-19T08:00:00Z", SessionType.ChannelSlack),
  ];

  it("shows all when both facets are fully on", () => {
    expect(filterFeed(items, ALL_STATES, ALL_CATEGORIES)).toHaveLength(4);
  });

  it("filters by state", () => {
    const states: ReadonlySet<FeedState> = new Set(["in-progress"]);
    const ids = filterFeed(items, states, ALL_CATEGORIES).map((i) => i.id);
    expect(ids).toEqual(["run"]);
  });

  it("filters by category", () => {
    const cats: ReadonlySet<SessionCategory> = new Set(["channels"]);
    const ids = filterFeed(items, ALL_STATES, cats).map((i) => i.id);
    expect(ids).toEqual(["slack"]);
  });

  it("AND across facets: state + category must both match", () => {
    const states: ReadonlySet<FeedState> = new Set(["unread"]);
    const cats: ReadonlySet<SessionCategory> = new Set(["scheduled"]);
    const ids = filterFeed(items, states, cats).map((i) => i.id);
    expect(ids).toEqual(["sched"]);
  });

  it("counts running and to-review separately", () => {
    expect(feedStats(items)).toEqual({ running: 1, toReview: 3 });
  });
});

describe("bucketOf", () => {
  const now = new Date("2026-08-19T14:00:00");

  it("puts today's items in Today", () => {
    expect(bucketOf("2026-08-19T06:00:00", now)).toBe("Today");
  });

  it("puts yesterday's items in Yesterday", () => {
    expect(bucketOf("2026-08-18T23:59:00", now)).toBe("Yesterday");
  });

  it("puts items from 4 days ago in Last 7 days", () => {
    expect(bucketOf("2026-08-15T10:00:00", now)).toBe("Last 7 days");
  });

  it("puts items from 20 days ago in Last 30 days", () => {
    expect(bucketOf("2026-07-30T10:00:00", now)).toBe("Last 30 days");
  });

  it("puts items older than 30 days in Older", () => {
    expect(bucketOf("2026-06-01T10:00:00", now)).toBe("Older");
  });

  it("handles null as Older", () => {
    expect(bucketOf(null, now)).toBe("Older");
  });
});

describe("emptyStateFor", () => {
  it("blames the filter when all states are excluded", () => {
    const state = emptyStateFor({
      allStatesExcluded: true,
      allCategoriesExcluded: false,
      noRunningAgents: false,
    });
    expect(state.tone).toBe("filtered");
  });

  it("blames the filter when all categories are excluded", () => {
    const state = emptyStateFor({
      allStatesExcluded: false,
      allCategoriesExcluded: true,
      noRunningAgents: false,
    });
    expect(state.tone).toBe("filtered");
  });

  it("reports nothing running when no agents are active", () => {
    const state = emptyStateFor({
      allStatesExcluded: false,
      allCategoriesExcluded: false,
      noRunningAgents: true,
    });
    expect(state.title).toBe("Nothing running");
  });

  it("reports unreadable agents", () => {
    const state = emptyStateFor({
      allStatesExcluded: false,
      allCategoriesExcluded: false,
      noRunningAgents: false,
      unreadableAgents: 2,
    });
    expect(state.title).toBe("Some agents did not answer");
  });

  it("blames the filter before a failed read", () => {
    const state = emptyStateFor({
      allStatesExcluded: true,
      allCategoriesExcluded: false,
      noRunningAgents: false,
      unreadableAgents: 3,
    });
    expect(state.title).toBe("Nothing included");
  });
});

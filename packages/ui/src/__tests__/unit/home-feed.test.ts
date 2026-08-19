import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  emptyStateFor,
  type FeedSource,
  feedStats,
  filterFeed,
} from "../../modules/home/lib/feed-filter.js";
import {
  type FeedItem,
  sortFeedItems,
} from "../../modules/home/lib/feed-item.js";
import type { SessionView } from "../../types.js";

// TEST_OVERVIEW: the Home feed's ordering and filtering rules, kept pure so they can be pinned here.

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

const ALL_SOURCES: ReadonlySet<FeedSource> = new Set(["channels", "schedules"]);

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

describe("filterFeed", () => {
  const items: FeedItem[] = [
    {
      kind: "approval",
      id: "ap",
      agentId: "a-1",
      at: "2026-08-19T12:00:00Z",
      approval: { id: "ap" } as never,
    },
    {
      kind: "in-progress",
      id: "run",
      agentId: "a-1",
      at: "2026-08-19T11:00:00Z",
      session: session({ sessionId: "run", running: true }),
    },
    unread("chat", "2026-08-19T10:00:00Z"),
    unread("sched", "2026-08-19T09:00:00Z", SessionType.ScheduleCron),
    unread("slack", "2026-08-19T08:00:00Z", SessionType.ChannelSlack),
  ];

  it("matches each status to its own kind", () => {
    const ids = (status: Parameters<typeof filterFeed>[1]) =>
      filterFeed(items, status, ALL_SOURCES).map((i) => i.id);

    expect(ids("all")).toHaveLength(5);
    expect(ids("attention")).toEqual(["ap"]);
    expect(ids("in-progress")).toEqual(["run"]);
    expect(ids("unread")).toEqual(["chat", "sched", "slack"]);
  });

  // TEST_SCENARIO: excluding a source must not take approvals with it — they belong to no source.
  it("keeps sourceless items when a source is excluded", () => {
    const ids = filterFeed(items, "all", new Set(["channels"])).map(
      (i) => i.id,
    );

    expect(ids).toEqual(["ap", "run", "chat", "slack"]);
  });

  it("drops everything sourced when no source is included", () => {
    const ids = filterFeed(items, "all", new Set()).map((i) => i.id);

    expect(ids).toEqual(["ap", "run", "chat"]);
  });

  it("counts running and to-review separately, ignoring approvals", () => {
    expect(feedStats(items)).toEqual({ running: 1, toReview: 3 });
  });
});

describe("emptyStateFor", () => {
  it("blames the filter before the system when every source is excluded", () => {
    const state = emptyStateFor("all", {
      allSourcesExcluded: true,
      noRunningAgents: false,
    });

    expect(state.tone).toBe("filtered");
  });

  // TEST_SCENARIO: with nothing running, unread is unknowable but approvals are still answerable.
  it("explains a stopped sandbox except when the user asked about approvals", () => {
    const noAgents = { allSourcesExcluded: false, noRunningAgents: true };

    expect(emptyStateFor("unread", noAgents).title).toBe("Nothing running");
    expect(emptyStateFor("attention", noAgents).title).toBe("All clear");
  });
});

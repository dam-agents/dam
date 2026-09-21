import type { AttentionItem } from "api-server-api";
import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  applyActivityFilters,
  channelTypeFor,
  defaultActivityFilters,
  isFiltered,
} from "../../modules/home/lib/activity-filter.js";
import {
  type FeedItem,
  sortFeedItems,
} from "../../modules/home/lib/feed-item.js";

// TEST_OVERVIEW: the activity feed's ordering and filtering rules, kept pure so they can be pinned here. The panel filters by the channel an item arrived through and by its state, so both halves are covered.

function session(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    sessionId: "s-1",
    agentId: "a-1",
    type: SessionType.Regular,
    mode: SessionMode.Chat,
    title: null,
    scheduleId: null,
    experimentId: null,
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
      session: session({ sessionId: "run", working: true }),
    },
    unread("chat", "2026-08-19T10:00:00Z"),
    unread("sched", "2026-08-19T09:00:00Z", SessionType.ScheduleCron),
    unread("slack", "2026-08-19T08:00:00Z", SessionType.ChannelSlack),
  ];

  const agents = [{ id: "a-1", channels: [] }] as unknown as Parameters<
    typeof channelTypeFor
  >[1];

  // TEST_SCENARIO: an item is filed by how it arrived — a schedule fire, a Slack thread, or a plain chat — because that is what a user filters on.
  it("files each item under the channel it arrived through", () => {
    const byId = Object.fromEntries(
      items.map((item) => [item.id, channelTypeFor(item, agents)]),
    );
    expect(byId["sched"]).toBe("schedule");
    expect(byId["slack"]).toBe("slack");
    expect(byId["chat"]).toBe("chat");
    expect(byId["ap"]).toBe("chat");
  });

  // TEST_SCENARIO: unchecking a type hides only that type, and the default set hides nothing.
  it("keeps only the checked channel types", () => {
    const base = defaultActivityFilters();
    expect(isFiltered(base)).toBe(false);
    expect(applyActivityFilters(items, base, agents)).toHaveLength(
      items.length,
    );

    const onlySchedule = {
      ...base,
      channelTypes: new Set(["schedule" as const]),
    };
    expect(isFiltered(onlySchedule)).toBe(true);
    expect(
      applyActivityFilters(items, onlySchedule, agents).map((i) => i.id),
    ).toEqual(["sched"]);
  });

  // TEST_SCENARIO: the state filter is separate from the type filter, so "in progress" means running whatever channel it came from.
  it("narrows by state independently of type", () => {
    const base = defaultActivityFilters();
    const running = applyActivityFilters(
      items,
      { ...base, state: "in-progress" },
      agents,
    );
    expect(running.map((i) => i.id)).toEqual(["run"]);

    const unreadOnly = applyActivityFilters(
      items,
      { ...base, state: "unread" },
      agents,
    );
    expect(unreadOnly.map((i) => i.id).sort()).toEqual([
      "chat",
      "sched",
      "slack",
    ]);
  });

  // TEST_SCENARIO: every state names the kinds it keeps, and each names different ones. An approval is what is waiting on the user, so it answers "needs attention" rather than arriving in the unread pile alongside messages nobody has to act on — and no two states may resolve to the same list, which is how a filter stops meaning anything.
  it("gives each state its own items", () => {
    const base = defaultActivityFilters();
    const byState = (state: "any" | "attention" | "in-progress" | "unread") =>
      applyActivityFilters(items, { ...base, state }, agents)
        .map((i) => i.id)
        .sort();

    expect(byState("attention")).toEqual(["ap"]);
    expect(byState("in-progress")).toEqual(["run"]);
    expect(byState("unread")).toEqual(["chat", "sched", "slack"]);
    expect(byState("any")).toHaveLength(items.length);
    expect(byState("attention")).not.toEqual(byState("in-progress"));
  });
});

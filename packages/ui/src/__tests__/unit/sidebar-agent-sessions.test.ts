import type { AttentionItem } from "api-server-api";
import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  groupSessionsByAgent,
  sidebarAgentFolded,
  sidebarAgentOpen,
} from "../../modules/agents/lib/sidebar-agent-order.js";
import { defaultActivityFilters } from "../../modules/home/lib/activity-filter.js";
import {
  matchesActivityFilters,
  toActivitySessions,
} from "../../modules/home/lib/activity-sessions.js";
import {
  newestFirst,
  nextSessionCursor,
  SIDEBAR_SESSION_STEP,
  sidebarSessionWindow,
  viewMore,
} from "../../modules/sessions/lib/sidebar-session-window.js";

// TEST_OVERVIEW: The sidebar lists each Agent's Sessions under the Agent, newest activity first, and no Session twice. An Agent shows its first five Sessions, and each click on View more shows five more, loading one more page only when the loaded rows run out. Paging stops when the Agent's cursor does not move or a page brings no new Session. The session filter in the Agents header applies to the attention record and to an Agent's own session list alike.

function attention(
  agentId: string,
  sessionId: string,
  activityAt: string,
): AttentionItem {
  return {
    agentId,
    sessionId,
    type: SessionType.Regular,
    mode: SessionMode.Chat,
    title: null,
    scheduleId: null,
    threadTs: null,
    harness: null,
    createdAt: "2026-10-01T08:00:00Z",
    activityAt,
    seenAt: activityAt,
    working: false,
  };
}

const records = [
  attention("a", "a-old", "2026-10-15T08:00:00Z"),
  attention("b", "b-new", "2026-10-15T12:00:00Z"),
  attention("a", "a-new", "2026-10-15T11:00:00Z"),
  attention("b", "b-old", "2026-10-15T09:00:00Z"),
];

describe("sessions grouped by agent", () => {
  const byAgent = groupSessionsByAgent(toActivitySessions(records, new Set()));

  it("TEST_SCENARIO: each Session lands under its own Agent once", () => {
    const ids = (agentId: string) =>
      byAgent.get(agentId)?.map((item) => item.session.sessionId);
    expect(ids("a")).toEqual(["a-new", "a-old"]);
    expect(ids("b")).toEqual(["b-new", "b-old"]);
    const all = [...byAgent.values()].flat().map((i) => i.id);
    expect(new Set(all).size).toBe(records.length);
  });
});

describe("the order of an agent's sessions", () => {
  const session = (id: string, at: string | null) => ({ id, at });
  const order = (sessions: { id: string; at: string | null }[]) =>
    newestFirst(
      sessions,
      (s) => s.at,
      (s) => s.id,
    ).map((s) => s.id);

  // TEST_SCENARIO: the user sees the Session with the newest activity at the top, and the oldest at the bottom.
  it("lists the newest activity first", () => {
    expect(
      order([
        session("week", "2026-10-10T08:00:00Z"),
        session("now", "2026-10-17T08:05:00Z"),
        session("hour", "2026-10-17T07:00:00Z"),
      ]),
    ).toEqual(["now", "hour", "week"]);
  });

  // TEST_SCENARIO: View more appends an older page to the Sessions already shown. The rows on screen keep their places, and the older Sessions go below them, whatever order the pages came in.
  it("keeps the rows already shown in place when an older page arrives", () => {
    const first = [
      session("s1", "2026-10-17T08:00:00Z"),
      session("s2", "2026-10-17T07:00:00Z"),
      session("s3", "2026-10-17T06:00:00Z"),
    ];
    const older = [
      session("s5", "2026-10-16T08:00:00Z"),
      session("s4", "2026-10-16T09:00:00Z"),
    ];
    const shown = order(first);
    expect(order([...first, ...older]).slice(0, shown.length)).toEqual(shown);
    expect(order([...older, ...first])).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });

  // TEST_SCENARIO: Sessions with the same activity time, or none that parses, keep one order on every render: by id, the undated ones last.
  it("breaks ties by id and puts undated Sessions last", () => {
    expect(
      order([
        session("b", "2026-10-17T08:00:00Z"),
        session("z", null),
        session("a", "2026-10-17T08:00:00Z"),
        session("y", "not a date"),
      ]),
    ).toEqual(["a", "b", "y", "z"]);
  });
});

describe("an agent's session window", () => {
  const n = SIDEBAR_SESSION_STEP;
  const sessions = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
  const none = () => false;

  it("TEST_SCENARIO: a list shows the newest five, and each View more five more", () => {
    expect(sidebarSessionWindow(sessions, n, none)).toEqual(
      sessions.slice(0, 5),
    );
    expect(sidebarSessionWindow(sessions, 2 * n, none)).toEqual(
      sessions.slice(0, 10),
    );
    expect(sidebarSessionWindow(sessions, 3 * n, none)).toEqual(sessions);
  });

  it("TEST_SCENARIO: the open Session stays visible, after the newest five", () => {
    expect(sidebarSessionWindow(sessions, n, (s) => s === "s9")).toEqual([
      ...sessions.slice(0, 5),
      "s9",
    ]);
    expect(sidebarSessionWindow(sessions, n, (s) => s === "s2")).toEqual(
      sessions.slice(0, 5),
    );
  });

  it("TEST_SCENARIO: View more shows while rows are hidden or another page waits, and an active Session past the window does not count as hidden", () => {
    const more = (total: number, shown: number, hasNextPage: boolean) =>
      viewMore({
        total,
        shown,
        limit: n,
        hasNextPage,
        isFetchingNextPage: false,
      }).more;
    expect(more(n, n, false)).toBe(false);
    expect(more(n, n, true)).toBe(true);
    expect(more(n + 1, n, false)).toBe(true);
    expect(more(n + 1, n + 1, false)).toBe(false);
  });

  it("TEST_SCENARIO: one click on View more adds five rows and fetches one page only when the loaded rows run out", () => {
    const click = (
      total: number,
      hasNextPage: boolean,
      isFetchingNextPage = false,
    ) =>
      viewMore({
        total,
        shown: n,
        limit: n,
        hasNextPage,
        isFetchingNextPage,
      });
    expect(click(2 * n, true)).toMatchObject({
      limit: 2 * n,
      fetchNextPage: false,
    });
    expect(click(2 * n - 1, true)).toMatchObject({
      limit: 2 * n,
      fetchNextPage: true,
    });
    expect(click(n + 1, false).fetchNextPage).toBe(false);
    expect(click(n + 1, true, true).fetchNextPage).toBe(false);
  });

  it("TEST_SCENARIO: paging stops when the cursor does not move or a page brings no new Session", () => {
    const page = (ids: string[], next: string | null) => ({
      sessions: ids.map((sessionId) => ({ sessionId })),
      nextCursor: next === null ? null : { sessionId: next },
    });
    const first = page(["s1", "s2"], "s2");
    expect(nextSessionCursor([first], null)).toEqual({ sessionId: "s2" });
    expect(
      nextSessionCursor([first, page(["s3"], "s3")], { sessionId: "s2" }),
    ).toEqual({ sessionId: "s3" });
    expect(
      nextSessionCursor([first, page(["s3"], null)], { sessionId: "s2" }),
    ).toBeNull();
    expect(
      nextSessionCursor([first, page(["s3"], "s2")], { sessionId: "s2" }),
    ).toBeNull();
    expect(
      nextSessionCursor([first, page(["s2"], "s9")], { sessionId: "s2" }),
    ).toBeNull();
    expect(
      nextSessionCursor([first, page([], "s9")], { sessionId: "s2" }),
    ).toBeNull();
  });
});

describe("the sidebar session filter", () => {
  it("TEST_SCENARIO: a Session from the Agent's own list, which may carry no schedule id, filters by its channel like an attention record", () => {
    const slack = {
      session: { type: SessionType.ChannelSlack, mode: SessionMode.Chat },
      working: true,
      unread: false,
      needsApproval: true,
    };
    const base = defaultActivityFilters();
    expect(matchesActivityFilters(slack, base)).toBe(true);
    expect(
      matchesActivityFilters(slack, {
        ...base,
        channelTypes: new Set(["chat"]),
      }),
    ).toBe(false);
    expect(matchesActivityFilters(slack, { ...base, state: "unread" })).toBe(
      false,
    );
    expect(
      matchesActivityFilters(slack, { ...base, state: "in-progress" }),
    ).toBe(true);
    expect(
      matchesActivityFilters(slack, { ...base, state: "needs-attention" }),
    ).toBe(true);
    expect(
      matchesActivityFilters(
        { ...slack, needsApproval: false },
        { ...base, state: "needs-attention" },
      ),
    ).toBe(false);
  });
});

describe("an agent's sessions open and close in the sidebar", () => {
  it("TEST_SCENARIO: the shown Agent is open until the user closes it, and a click opens any other Agent in place", () => {
    expect(sidebarAgentOpen({}, "a-1", "a-1")).toBe(true);
    expect(sidebarAgentOpen({}, "a-2", "a-1")).toBe(false);
    expect(sidebarAgentOpen({ "a-1": false }, "a-1", "a-1")).toBe(false);
    expect(sidebarAgentOpen({ "a-2": true }, "a-2", "a-1")).toBe(true);
    expect(sidebarAgentOpen({ "a-2": true }, "a-2", null)).toBe(true);
  });

  it("TEST_SCENARIO: opening a Session from Activity keeps its Agent's row as it was, closed or open", () => {
    const fromActivity = (
      overrides: Record<string, boolean>,
      agentId: string,
      shownAgentId: string | null,
    ) => ({
      ...overrides,
      [agentId]: sidebarAgentOpen(overrides, agentId, shownAgentId),
    });
    const closed = fromActivity({}, "a-2", "a-1");
    expect(sidebarAgentOpen(closed, "a-2", "a-2")).toBe(false);
    const open = fromActivity({}, "a-1", "a-1");
    expect(sidebarAgentOpen(open, "a-1", "a-1")).toBe(true);
    const opened = fromActivity({ "a-2": true }, "a-2", null);
    expect(sidebarAgentOpen(opened, "a-2", "a-2")).toBe(true);
  });
});

describe("hibernated Agents fold under See all", () => {
  const sleeping = { id: "a-1", state: "hibernated" } as const;
  it("TEST_SCENARIO: a hibernated Agent folds unless it is open or shown; closing the shown Agent's Sessions keeps its row in place", () => {
    expect(sidebarAgentFolded({}, sleeping, null)).toBe(true);
    expect(sidebarAgentFolded({ "a-1": true }, sleeping, null)).toBe(false);
    expect(sidebarAgentFolded({}, sleeping, "a-1")).toBe(false);
    expect(sidebarAgentFolded({ "a-1": false }, sleeping, "a-1")).toBe(false);
    expect(sidebarAgentFolded({}, { id: "a-1", state: "running" }, null)).toBe(
      false,
    );
  });
});

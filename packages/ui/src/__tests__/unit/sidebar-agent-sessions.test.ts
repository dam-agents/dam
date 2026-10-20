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
  moreClick,
  newestFirst,
  nextSessionCursor,
  sessionListControls,
  SIDEBAR_PREVIEW_SESSIONS,
  sidebarSessionWindow,
} from "../../modules/sessions/lib/sidebar-session-window.js";

// TEST_OVERVIEW: The sidebar lists each Agent's Sessions under the Agent, newest activity first, and no Session twice. An Agent shows its first three Sessions until the user clicks More, which lists the rest it has loaded; each further click on More loads one more page, and Less collapses the list. Paging stops when the Agent's cursor does not move or a page brings no new Session. The session filter in the Agents header applies to the attention record and to an Agent's own session list alike.

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

  // TEST_SCENARIO: MORE appends an older page to the Sessions already shown. The rows on screen keep their places, and the older Sessions go below them, whatever order the pages came in.
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
  const sessions = ["s1", "s2", "s3", "s4", "s5"];
  const none = () => false;

  it("TEST_SCENARIO: a collapsed list shows the newest three, and More lists all", () => {
    expect(sidebarSessionWindow(sessions, false, none)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
    expect(sidebarSessionWindow(sessions, true, none)).toEqual(sessions);
  });

  it("TEST_SCENARIO: the open Session stays visible in a collapsed list, after the newest three", () => {
    expect(sidebarSessionWindow(sessions, false, (s) => s === "s5")).toEqual([
      "s1",
      "s2",
      "s3",
      "s5",
    ]);
    expect(sidebarSessionWindow(sessions, false, (s) => s === "s2")).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("TEST_SCENARIO: More shows while there is more to list, and Less once expanded", () => {
    const n = SIDEBAR_PREVIEW_SESSIONS;
    const controls = (
      total: number,
      expanded: boolean,
      hasNextPage: boolean,
      collapsed = n,
    ) => sessionListControls({ total, collapsed, expanded, hasNextPage });
    expect(controls(n, false, false)).toEqual({ more: false, less: false });
    expect(controls(n, false, true)).toEqual({ more: true, less: false });
    expect(controls(n + 1, false, false)).toEqual({ more: true, less: false });
    expect(controls(n + 1, true, false)).toEqual({ more: false, less: true });
    expect(controls(n + 1, true, true)).toEqual({ more: true, less: true });
  });

  it("TEST_SCENARIO: an active Session past the first three joins the window without a More that reveals nothing", () => {
    const n = SIDEBAR_PREVIEW_SESSIONS;
    const rows = Array.from({ length: n + 1 }, (_, i) => `s${i + 1}`);
    const collapsed = sidebarSessionWindow(
      rows,
      false,
      (s) => s === `s${n + 1}`,
    );
    expect(collapsed).toEqual(rows);
    const args = { total: rows.length, collapsed: collapsed.length };
    expect(
      sessionListControls({ ...args, expanded: false, hasNextPage: false }),
    ).toEqual({ more: false, less: false });
    expect(
      moreClick({
        ...args,
        expanded: false,
        hasNextPage: true,
        isFetchingNextPage: false,
      }),
    ).toEqual({ expand: true, fetchNextPage: true });
  });

  it("TEST_SCENARIO: one click on More fetches at most one page", () => {
    const n = SIDEBAR_PREVIEW_SESSIONS;
    const click = (
      total: number,
      expanded: boolean,
      hasNextPage: boolean,
      isFetchingNextPage = false,
    ) =>
      moreClick({
        total,
        collapsed: n,
        expanded,
        hasNextPage,
        isFetchingNextPage,
      });
    expect(click(n + 1, false, true)).toEqual({
      expand: true,
      fetchNextPage: false,
    });
    expect(click(n, false, true)).toEqual({
      expand: true,
      fetchNextPage: true,
    });
    expect(click(n + 1, true, true)).toEqual({
      expand: false,
      fetchNextPage: true,
    });
    expect(click(n + 1, true, false).fetchNextPage).toBe(false);
    expect(click(n + 1, true, true, true).fetchNextPage).toBe(false);
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

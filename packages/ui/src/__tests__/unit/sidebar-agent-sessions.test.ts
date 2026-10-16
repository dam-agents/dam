import type { AttentionItem } from "api-server-api";
import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  groupSessionsByAgent,
  leadAgentId,
  openFirst,
  orderByLatestSession,
} from "../../modules/agents/lib/sidebar-agent-order.js";
import { pinnedFirst } from "../../modules/agents/lib/sidebar-pins.js";
import { defaultActivityFilters } from "../../modules/home/lib/activity-filter.js";
import {
  matchesActivityFilters,
  toActivitySessions,
} from "../../modules/home/lib/activity-sessions.js";
import {
  sessionListToggle,
  SIDEBAR_PREVIEW_SESSIONS,
  sidebarSessionWindow,
} from "../../modules/sessions/lib/sidebar-session-window.js";

// TEST_OVERVIEW: The sidebar lists each Agent's Sessions under the Agent, and no Session twice. Agents are ordered by their newest Session, after the pinned Agents, and the Agent the user has open comes first of all, once the pointer leaves the list, so no row moves under the cursor. Each Agent shows its newest Sessions first. An Agent shows three Sessions, or all its pinned Sessions when there are more, until the user clicks More, which lists the rest and turns into Less. The session filter in the Agents header applies to the attention record and to an Agent's own session list alike.

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

  it("TEST_SCENARIO: each Session lands under its own Agent once, newest first", () => {
    const ids = (agentId: string) =>
      byAgent.get(agentId)?.map((item) => item.session.sessionId);
    expect(ids("a")).toEqual(["a-new", "a-old"]);
    expect(ids("b")).toEqual(["b-new", "b-old"]);
    const all = [...byAgent.values()].flat().map((i) => i.id);
    expect(new Set(all).size).toBe(records.length);
  });

  it("TEST_SCENARIO: Agents follow their newest Session, and Agents with no Session go last in their old order", () => {
    const agents = [
      { id: "idle-1" },
      { id: "a" },
      { id: "idle-2" },
      { id: "b" },
    ];
    expect(orderByLatestSession(agents, byAgent).map((a) => a.id)).toEqual([
      "b",
      "a",
      "idle-1",
      "idle-2",
    ]);
  });

  it("TEST_SCENARIO: the open Agent comes first, above the pinned Agents, and the others keep their order", () => {
    const agents = ["b", "a", "idle-1", "idle-2"].map((id) => ({ id }));
    const ordered = pinnedFirst(agents, ["a"], (agent) => agent.id).items;
    const ids = (openAgentId: string | null) =>
      openFirst(ordered, openAgentId).map((a) => a.id);
    expect(ids("idle-2")).toEqual(["idle-2", "a", "b", "idle-1"]);
    expect(ids("idle-1")).toEqual(["idle-1", "a", "b", "idle-2"]);
    expect(ids("a")).toEqual(["a", "b", "idle-1", "idle-2"]);
    expect(ids(null)).toEqual(["a", "b", "idle-1", "idle-2"]);
    expect(ids("deleted")).toEqual(["a", "b", "idle-1", "idle-2"]);
  });

  it("TEST_SCENARIO: while the pointer is over the list, the Agent shown first stays first; when it leaves, the open Agent takes its place", () => {
    expect(leadAgentId("a", "b", true)).toBe("a");
    expect(leadAgentId(null, "b", true)).toBeNull();
    expect(leadAgentId("a", "b", false)).toBe("b");
    expect(leadAgentId("a", null, false)).toBeNull();
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

  it("TEST_SCENARIO: More shows only when there is more to list, and turns into Less once expanded", () => {
    const n = SIDEBAR_PREVIEW_SESSIONS;
    expect(
      sessionListToggle({ total: n, expanded: false, hasNextPage: false }),
    ).toBeNull();
    expect(
      sessionListToggle({ total: n, expanded: false, hasNextPage: true }),
    ).toBe("more");
    expect(
      sessionListToggle({ total: n + 1, expanded: false, hasNextPage: false }),
    ).toBe("more");
    expect(
      sessionListToggle({ total: n + 1, expanded: true, hasNextPage: false }),
    ).toBe("less");
  });

  it("TEST_SCENARIO: a collapsed list shows every pinned Session, even past three, and More counts only what is still hidden", () => {
    expect(sidebarSessionWindow(sessions, false, none, 4)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
    expect(
      sessionListToggle({
        total: 4,
        expanded: false,
        hasNextPage: false,
        pinned: 4,
      }),
    ).toBeNull();
    expect(
      sessionListToggle({
        total: 5,
        expanded: false,
        hasNextPage: false,
        pinned: 4,
      }),
    ).toBe("more");
  });
});

describe("the sidebar session filter", () => {
  it("TEST_SCENARIO: a Session from the Agent's own list, which may carry no schedule id, filters by its channel like an attention record", () => {
    const slack = {
      session: { type: SessionType.ChannelSlack, mode: SessionMode.Chat },
      working: true,
      unread: false,
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
  });
});

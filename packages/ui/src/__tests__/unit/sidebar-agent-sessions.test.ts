import type { AttentionItem } from "api-server-api";
import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it } from "vitest";

import { groupSessionsByAgent } from "../../modules/agents/lib/sidebar-agent-order.js";
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

// TEST_OVERVIEW: The sidebar lists each Agent's Sessions under the Agent, and no Session twice. An Agent shows its first three Sessions until the user clicks More, which lists the rest and turns into Less. The session filter in the Agents header applies to the attention record and to an Agent's own session list alike.

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

  it("TEST_SCENARIO: each Session lands under its own Agent once", () => {
    const ids = (agentId: string) =>
      byAgent.get(agentId)?.map((item) => item.session.sessionId);
    expect(ids("a")).toEqual(["a-new", "a-old"]);
    expect(ids("b")).toEqual(["b-new", "b-old"]);
    const all = [...byAgent.values()].flat().map((i) => i.id);
    expect(new Set(all).size).toBe(records.length);
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

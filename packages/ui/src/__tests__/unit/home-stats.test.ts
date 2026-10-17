import { type AttentionItem, SessionMode } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  agentStates,
  busiestAgents,
  channelMix,
  dailyActivity,
  harnessMix,
  sessionsToday,
} from "../../modules/home/lib/home-stats.js";
import type { AgentView } from "../../types.js";

/**
 * TEST_OVERVIEW: The Home dashboard counts recent Sessions by channel and by
 * day, and Agents by state and harness, from the owner's attention feed and
 * Agents list. Each count puts every Session or Agent in exactly one bucket.
 */

const now = new Date("2026-10-18T12:00:00Z");

const session = (
  agentId: string,
  at: string,
  extra: Partial<AttentionItem> = {},
): AttentionItem =>
  ({
    agentId,
    sessionId: `${agentId}-${at}`,
    mode: "chat",
    type: "regular",
    title: null,
    scheduleId: null,
    threadTs: null,
    harness: null,
    createdAt: at,
    activityAt: at,
    seenAt: null,
    working: false,
    ...extra,
  }) as AttentionItem;

const agent = (id: string, extra: Partial<AgentView> = {}) =>
  ({
    id,
    name: id,
    state: "running",
    harness: "claude-code",
    ...extra,
  }) as AgentView;

const sessions = [
  session("a", "2026-10-18T09:00:00Z"),
  session("a", "2026-10-18T01:00:00Z", { type: "channel_slack" }),
  session("b", "2026-10-17T22:00:00Z", { scheduleId: "s1" }),
  session("b", "2026-10-10T10:00:00Z", { mode: SessionMode.Terminal }),
  session("c", "2026-09-01T10:00:00Z", { type: "channel_telegram" }),
];

describe("home stats", () => {
  // TEST_SCENARIO: every Session lands in one channel, schedules winning over the channel they post to.
  it("splits Sessions by channel", () => {
    expect(
      Object.fromEntries(channelMix(sessions).map((c) => [c.key, c.count])),
    ).toEqual({
      chat: 1,
      slack: 1,
      telegram: 1,
      schedule: 1,
      terminal: 1,
    });
  });

  // TEST_SCENARIO: the last 14 UTC days are counted with today last, and older Sessions fall outside.
  it("counts Sessions per day for the last two weeks", () => {
    const days = dailyActivity(sessions, now);
    expect(days).toHaveLength(14);
    expect(days[13]).toEqual({ day: "2026-10-18", count: 2 });
    expect(days[12]).toEqual({ day: "2026-10-17", count: 1 });
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(4);
    expect(sessionsToday(sessions, now)).toBe(2);
  });

  // TEST_SCENARIO: an Agent is working, idle, asleep or in trouble, never two at once, and errors beat sleep.
  it("buckets Agents by state", () => {
    const states = agentStates(
      [
        agent("w"),
        agent("i"),
        agent("s", { state: "hibernated" }),
        agent("e", { state: "error" }),
        agent("o", { state: "hibernated", overBudget: true }),
      ],
      new Set(["w"]),
    );
    expect(Object.fromEntries(states.map((s) => [s.key, s.count]))).toEqual({
      working: 1,
      awake: 1,
      asleep: 1,
      trouble: 2,
    });
  });

  // TEST_SCENARIO: harnesses and busiest Agents sort by count, most first, and a Session of a deleted Agent is skipped.
  it("ranks harnesses and busiest Agents", () => {
    expect(
      harnessMix([agent("a"), agent("b", { harness: "codex" }), agent("c")]),
    ).toEqual([
      { key: "claude-code", count: 2 },
      { key: "codex", count: 1 },
    ]);
    expect(
      busiestAgents(sessions, [agent("a"), agent("b")]).map((r) => [
        r.agent.id,
        r.count,
      ]),
    ).toEqual([
      ["a", 2],
      ["b", 2],
    ]);
  });
});

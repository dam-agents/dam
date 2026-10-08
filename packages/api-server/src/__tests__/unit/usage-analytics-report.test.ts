import { describe, expect, it } from "vitest";

import type {
  AnalyticsFacts,
  LiveAgentFact,
} from "../../modules/usage/domain/analytics-report.js";
import { buildAnalyticsReport } from "../../modules/usage/domain/build-analytics-report.js";

// TEST_OVERVIEW: the usage analytics report turns per-user facts into panel
// TEST_OVERVIEW: numbers. The top panel is the last 7 complete UTC days, the
// TEST_OVERVIEW: trends are Monday-to-Sunday weeks with the current week left
// TEST_OVERVIEW: out, and a cohort shows only once all its users have had a
// TEST_OVERVIEW: full first week. Today is Thursday 8 October 2026.

const NOW = new Date("2026-10-08T09:00:00Z");
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

function facts(overrides: Partial<AnalyticsFacts> = {}): AnalyticsFacts {
  return {
    users: [],
    activeDays: [],
    featureFirsts: [],
    slackSetups: [],
    kitAgents: [],
    agentsCreated: [],
    liveAgents: [],
    oomAgentIds: new Set(),
    knowledgeBaseConnectionIds: new Set(),
    sizing: { slot: { cpu: "1", memory: "2Gi" }, defaultStorage: "10Gi" },
    ...overrides,
  };
}

const days = (sub: string, ...isoDays: string[]) =>
  isoDays.map((day) => ({ sub, day }));

describe("usage analytics report", () => {
  // TEST_SCENARIO: every window is fixed by today's date, so the same report
  // read twice in a day gives the same numbers and today never shows as a
  // half-filled day.
  it("places the windows on whole UTC days and complete weeks", () => {
    const r = buildAnalyticsReport(facts(), NOW);
    expect(r.last7.from).toBe("2026-10-01");
    expect(r.last7.to).toBe("2026-10-07");
    expect(r.last7.previousFrom).toBe("2026-09-24");
    expect(r.allUse.weeks.at(-1)).toBe("2026-09-28");
    expect(r.allUse.weeks).toHaveLength(8);
    expect(r.onboarding.cohortWeeks.at(-1)).toBe("2026-09-21");
  });

  // TEST_SCENARIO: an abandoned user is one who signed in before the window
  // and had no active day in it; a user whose first sign-in is today is not
  // counted in a window that ends before today.
  it("counts active, regular, super and abandoned users in the last 7 days", () => {
    const r = buildAnalyticsReport(
      facts({
        users: [
          { sub: "a", firstSeenAt: at("2026-09-01") },
          { sub: "b", firstSeenAt: at("2026-09-01") },
          { sub: "c", firstSeenAt: at("2026-10-08") },
        ],
        activeDays: [
          ...days("a", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"),
          ...days("a", "2026-09-30"),
          ...days("c", "2026-10-08"),
        ],
      }),
      NOW,
    );
    expect(r.last7.weeklyActive.value).toBe(1);
    expect(r.last7.weeklyActive.regular).toBe(1);
    expect(r.last7.weeklyActive.super).toBe(1);
    expect(r.last7.weeklyAbandoned.value).toBe(1);
    expect(r.last7.weeklyActive.previous).toBe(1);
  });

  // TEST_SCENARIO: conversion looks at users whose first week ended within the
  // last 7 days, so every one of them had the full week to reach 3 active days.
  it("measures onboarding conversion on first weeks that ended in the window", () => {
    const r = buildAnalyticsReport(
      facts({
        users: [
          { sub: "done", firstSeenAt: at("2026-09-25") },
          { sub: "slow", firstSeenAt: at("2026-09-26") },
          { sub: "new", firstSeenAt: at("2026-10-03") },
        ],
        activeDays: [
          ...days("done", "2026-09-25", "2026-09-26", "2026-09-27"),
          ...days("slow", "2026-09-26"),
          ...days("new", "2026-10-03", "2026-10-04", "2026-10-05"),
        ],
      }),
      NOW,
    );
    expect(r.last7.onboardingConversion.users).toBe(2);
    expect(r.last7.onboardingConversion.value).toBe(50);
  });

  // TEST_SCENARIO: the funnel counts everyone in its first columns, but "active
  // in week 3" only counts users who have had three weeks, with its own base.
  it("gives the last funnel stage its own base of users 21 days in", () => {
    const r = buildAnalyticsReport(
      facts({
        users: [
          { sub: "old", firstSeenAt: at("2026-09-01") },
          { sub: "recent", firstSeenAt: at("2026-10-01") },
        ],
        activeDays: [
          ...days("old", "2026-09-01", "2026-09-16"),
          ...days("recent", "2026-10-01"),
        ],
      }),
      NOW,
    );
    const stage = (label: string) =>
      r.onboarding.funnel.find((s) => s.label === label)!;
    expect(stage("Logged in")).toMatchObject({ count: 2, base: 2 });
    expect(stage("1st active day")).toMatchObject({ count: 2, base: 2 });
    expect(stage("2nd active day")).toMatchObject({ count: 1, base: 2 });
    expect(stage("Active in week 3")).toMatchObject({ count: 1, base: 1 });
  });

  // TEST_SCENARIO: a user with several starter-kit agents counts once, by their
  // first completed checklist, measured from that agent's creation; a user who
  // never opened a checklist is "not started".
  it("buckets checklist completion per user", () => {
    const r = buildAnalyticsReport(
      facts({
        users: [
          { sub: "u1", firstSeenAt: at("2026-09-22") },
          { sub: "u2", firstSeenAt: at("2026-09-23") },
        ],
        kitAgents: [
          {
            agentId: "k1",
            sub: "u1",
            kitId: "nous",
            createdAt: at("2026-09-22"),
            onboardedAt: null,
            checklistStarted: true,
          },
          {
            agentId: "k2",
            sub: "u1",
            kitId: "gepa",
            createdAt: at("2026-09-23"),
            onboardedAt: at("2026-09-25"),
            checklistStarted: true,
          },
          {
            agentId: "k3",
            sub: "u2",
            kitId: "nous",
            createdAt: at("2026-09-23"),
            onboardedAt: null,
            checklistStarted: false,
          },
        ],
      }),
      NOW,
    );
    const row = r.onboarding.checklistCompletion.rows.at(-1)!;
    expect(row.weekStart).toBe("2026-09-21");
    expect(row.size).toBe(2);
    expect(row.counts).toEqual([0, 1, 0, 0, 1]);
    expect(r.allUse.checklistState.map((s) => s.count)).toEqual([1, 0, 1]);
  });

  // TEST_SCENARIO: the agents panels read live agents but count only those a
  // non-core user created, and size an agent by whole slots.
  it("sizes live agents and leaves out agents nobody counted", () => {
    const live = (id: string, extra: Partial<LiveAgentFact> = {}): LiveAgentFact => ({
      id,
      cpu: undefined,
      memory: undefined,
      hibernationTimeout: undefined,
      storageSize: undefined,
      grantedConnectionIds: [],
      ...extra,
    });
    const r = buildAnalyticsReport(
      facts({
        agentsCreated: ["x1", "x2", "x3"].map((agentId) => ({
          agentId,
          ownerSub: "u",
          createdAt: at("2026-09-01"),
          kitId: null,
        })),
        liveAgents: [
          live("x1"),
          live("x2", { cpu: "2", memory: "4Gi", hibernationTimeout: "0s" }),
          live("x3", { cpu: "2", memory: "2Gi", grantedConnectionIds: ["kb", "c"] }),
          live("core-agent", { cpu: "4", memory: "8Gi" }),
        ],
        oomAgentIds: new Set(["x2"]),
        knowledgeBaseConnectionIds: new Set(["kb"]),
      }),
      NOW,
    );
    expect(r.agentsNow.total).toBe(3);
    expect(r.agentsNow.sizes).toEqual([
      { size: "1x", agents: 1, alwaysOn: 0, outOfMemory: 0 },
      { size: "2x", agents: 1, alwaysOn: 1, outOfMemory: 1 },
      { size: "4x", agents: 0, alwaysOn: 0, outOfMemory: 0 },
      { size: "custom", agents: 1, alwaysOn: 0, outOfMemory: 0 },
    ]);
    expect(r.agentsNow.knowledgeBases.map((s) => s.count)).toEqual([2, 1, 0, 0]);
    expect(r.agentsNow.connections.map((s) => s.count)).toEqual([2, 0, 1, 0]);
  });
});

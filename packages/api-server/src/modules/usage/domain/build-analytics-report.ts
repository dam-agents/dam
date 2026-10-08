import {
  dayFromIsoDate,
  dayOf,
  elapsedDays,
  isoDateOf,
  lastCompleteWeekStart,
  latestEligibleCohortStart,
  rollingWindow,
  weekStartsEndingAt,
  type DayNumber,
  type DayWindow,
} from "./analytics-days.js";
import {
  CORE_FEATURES,
  type AnalyticsFacts,
  type AnalyticsReport,
  type CohortPanel,
  type CoreFeature,
  type LiveAgentFact,
  type Share,
  type SizeRow,
  type Tile,
  type WeeklySeries,
} from "./analytics-report.js";
import { parseCpuMilli, parseMemoryBytes } from "./quantities.js";

const TREND_WINDOWS = 8;
const TREND_WEEKS = 8;
const LONGITUDINAL_WEEKS = 6;
const COHORTS = 6;
const REGULAR_DAYS = 3;
const SUPER_DAYS = 5;
const LONGITUDINAL_SPAN = 21;
const FUNNEL_SPAN = 21;
const OOM_WINDOW_DAYS = 30;

const FEATURE_LABELS: Record<CoreFeature, string> = {
  starter_kit: "Starter kit",
  artifact: "Artifact",
  scheduling: "Scheduling",
  slack_agent: "Agent in Slack",
  skills: "Skills mounting",
};

type User = {
  sub: string;
  firstSeenAt: Date;
  firstDay: DayNumber;
  activeDays: DayNumber[];
};

type Population = {
  users: User[];
  bySub: Map<string, User>;
};

function population(facts: AnalyticsFacts): Population {
  const days = new Map<string, DayNumber[]>();
  for (const d of facts.activeDays) {
    const list = days.get(d.sub) ?? [];
    list.push(dayFromIsoDate(d.day));
    days.set(d.sub, list);
  }
  const users = facts.users.map((u) => ({
    sub: u.sub,
    firstSeenAt: u.firstSeenAt,
    firstDay: dayOf(u.firstSeenAt),
    activeDays: days.get(u.sub) ?? [],
  }));
  return { users, bySub: new Map(users.map((u) => [u.sub, u])) };
}

function activeIn(user: User, w: DayWindow): number {
  let n = 0;
  for (const d of user.activeDays) if (d >= w.from && d < w.to) n++;
  return n;
}

function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100);
}

function percentOrZero(part: number, whole: number): number {
  return percent(part, whole) ?? 0;
}

type WindowActivity = {
  active: number;
  regular: number;
  super: number;
  abandoned: number;
};

function windowActivity(pop: Population, w: DayWindow): WindowActivity {
  const out = { active: 0, regular: 0, super: 0, abandoned: 0 };
  for (const u of pop.users) {
    if (u.firstDay >= w.to) continue;
    const n = activeIn(u, w);
    if (n === 0) out.abandoned++;
    if (n >= 1) out.active++;
    if (n >= REGULAR_DAYS) out.regular++;
    if (n >= SUPER_DAYS) out.super++;
  }
  return out;
}

function longitudinalActivity(
  pop: Population,
  end: DayNumber,
): WindowActivity & { eligible: number } {
  const out = { active: 0, regular: 0, super: 0, abandoned: 0, eligible: 0 };
  const weeks = [0, 1, 2].map((k) => rollingWindow(end, k));
  for (const u of pop.users) {
    if (u.firstDay > end - LONGITUDINAL_SPAN) continue;
    out.eligible++;
    const counts = weeks.map((w) => activeIn(u, w));
    const least = Math.min(...counts);
    if (counts.every((n) => n === 0)) out.abandoned++;
    if (least >= 1) out.active++;
    if (least >= REGULAR_DAYS) out.regular++;
    if (least >= SUPER_DAYS) out.super++;
  }
  return out;
}

function agentsIn(facts: AnalyticsFacts, w: DayWindow) {
  let fromKits = 0;
  let other = 0;
  for (const a of facts.agentsCreated) {
    const d = dayOf(a.createdAt);
    if (d < w.from || d >= w.to) continue;
    if (a.kitId) fromKits++;
    else other++;
  }
  return { fromKits, other };
}

function onboardingConversion(pop: Population, w: DayWindow) {
  let users = 0;
  let converted = 0;
  for (const u of pop.users) {
    const firstWeekEnd = u.firstDay + 7;
    if (firstWeekEnd <= w.from || firstWeekEnd > w.to) continue;
    users++;
    const n = activeIn(u, { from: u.firstDay, to: firstWeekEnd });
    if (n >= REGULAR_DAYS) converted++;
  }
  return { users, converted };
}

function tile(values: Array<number | null>): Tile {
  return {
    value: values[0] ?? null,
    previous: values[1] ?? null,
    trend: [...values].reverse(),
  };
}

function buildLast7(
  facts: AnalyticsFacts,
  pop: Population,
  today: DayNumber,
): AnalyticsReport["last7"] {
  const windows = Array.from({ length: TREND_WINDOWS }, (_, k) =>
    rollingWindow(today, k),
  );
  const activity = windows.map((w) => windowActivity(pop, w));
  const longitudinal = windows.map((w) => longitudinalActivity(pop, w.to));
  const agents = windows.map((w) => agentsIn(facts, w));
  const conversion = windows.map((w) => onboardingConversion(pop, w));
  const current = windows[0]!;
  return {
    from: isoDateOf(current.from),
    to: isoDateOf(current.to - 1),
    previousFrom: isoDateOf(windows[1]!.from),
    weeklyActive: {
      ...tile(activity.map((a) => a.active)),
      regular: activity[0]!.regular,
      super: activity[0]!.super,
    },
    weeklyAbandoned: tile(activity.map((a) => a.abandoned)),
    longitudinallyActive: {
      ...tile(longitudinal.map((l) => l.active)),
      eligible: longitudinal[0]!.eligible,
    },
    agentsCreated: {
      ...tile(agents.map((a) => a.fromKits + a.other)),
      fromKits: agents[0]!.fromKits,
      other: agents[0]!.other,
    },
    starterKitAdoption: tile(
      agents.map((a) => percent(a.fromKits, a.fromKits + a.other)),
    ),
    onboardingConversion: {
      ...tile(conversion.map((c) => percent(c.converted, c.users))),
      users: conversion[0]!.users,
    },
  };
}

function cohortPanel(
  cohorts: User[][],
  starts: DayNumber[],
  categories: string[],
  bucketOf: (u: User) => number | null,
): CohortPanel {
  return {
    categories,
    rows: cohorts.map((members, i) => {
      const counts = categories.map(() => 0);
      let size = 0;
      for (const u of members) {
        const b = bucketOf(u);
        if (b === null) continue;
        counts[b]!++;
        size++;
      }
      return { weekStart: isoDateOf(starts[i]!), size, counts };
    }),
  };
}

function lagBucket(lagDays: number): number {
  if (lagDays < 1) return 0;
  if (lagDays < 7) return 1;
  return 2;
}

function buildOnboarding(
  facts: AnalyticsFacts,
  pop: Population,
  today: DayNumber,
): AnalyticsReport["onboarding"] {
  const starts = weekStartsEndingAt(latestEligibleCohortStart(today), COHORTS);
  const cohorts = starts.map((m) =>
    pop.users.filter((u) => u.firstDay >= m && u.firstDay < m + 7),
  );

  const firstDayFeatures = new Map<string, Set<CoreFeature>>();
  for (const f of facts.featureFirsts) {
    const user = pop.bySub.get(f.sub);
    if (!user || dayOf(f.firstAt) !== user.firstDay) continue;
    const set = firstDayFeatures.get(f.sub) ?? new Set<CoreFeature>();
    set.add(f.feature);
    firstDayFeatures.set(f.sub, set);
  }
  const featuresOnDayOne = (u: User) => firstDayFeatures.get(u.sub)?.size ?? 0;

  const slackFirst = new Map(facts.slackSetups.map((s) => [s.sub, s.firstAt]));

  const kitAgentsBySub = new Map<string, AnalyticsFacts["kitAgents"][number][]>();
  for (const k of facts.kitAgents) {
    const list = kitAgentsBySub.get(k.sub) ?? [];
    list.push(k);
    kitAgentsBySub.set(k.sub, list);
  }

  const funnelBase = pop.users.length;
  const funnelStages = [1, 2, 3, 4].map((n) => ({
    label: `${ordinal(n)} active day`,
    count: pop.users.filter(
      (u) =>
        activeIn(u, { from: u.firstDay, to: u.firstDay + FUNNEL_SPAN }) >= n,
    ).length,
    base: funnelBase,
  }));
  const weekThreeBase = pop.users.filter(
    (u) => u.firstDay + FUNNEL_SPAN <= today,
  );
  const funnel = [
    { label: "Logged in", count: funnelBase, base: funnelBase },
    ...funnelStages,
    {
      label: "Active in week 3",
      count: weekThreeBase.filter(
        (u) => activeIn(u, { from: u.firstDay + 14, to: u.firstDay + 21 }) >= 1,
      ).length,
      base: weekThreeBase.length,
    },
  ];

  const eligible = cohorts.flat();
  const agentsOnDayOne = new Map<string, { kit: string[]; other: number }>();
  for (const a of facts.agentsCreated) {
    const user = pop.bySub.get(a.ownerSub);
    if (!user || dayOf(a.createdAt) !== user.firstDay) continue;
    const entry = agentsOnDayOne.get(a.ownerSub) ?? { kit: [], other: 0 };
    if (a.kitId) entry.kit.push(a.kitId);
    else entry.other++;
    agentsOnDayOne.set(a.ownerSub, entry);
  }
  let withKit = 0;
  let scratchOnly = 0;
  const kitUsers = new Map<string, number>();
  for (const u of eligible) {
    const entry = agentsOnDayOne.get(u.sub);
    if (!entry) continue;
    if (entry.kit.length === 0) {
      scratchOnly++;
      continue;
    }
    withKit++;
    for (const kit of new Set(entry.kit)) {
      kitUsers.set(kit, (kitUsers.get(kit) ?? 0) + 1);
    }
  }

  return {
    cohortWeeks: starts.map(isoDateOf),
    cohortSizes: cohorts.map((c) => c.length),
    funnel,
    firstWeekActiveDays: cohortPanel(
      cohorts,
      starts,
      ["None", "1 day", "2 days", "3+ days"],
      (u) =>
        Math.min(3, activeIn(u, { from: u.firstDay, to: u.firstDay + 7 })),
    ),
    firstDayFeatureCount: cohortPanel(
      cohorts,
      starts,
      ["None", "1", "2", "3", "4", "All 5"],
      featuresOnDayOne,
    ),
    firstDayFeatureUse: [
      {
        label: "No feature",
        percents: cohorts.map((c) =>
          percentOrZero(c.filter((u) => featuresOnDayOne(u) === 0).length, c.length),
        ),
      },
      ...CORE_FEATURES.map((feature) => ({
        label: FEATURE_LABELS[feature],
        percents: cohorts.map((c) =>
          percentOrZero(
            c.filter((u) => firstDayFeatures.get(u.sub)?.has(feature)).length,
            c.length,
          ),
        ),
      })),
    ],
    firstDayStart: [
      { label: "Starter-kit agent", count: withKit },
      { label: "Agent from scratch", count: scratchOnly },
      { label: "No agent", count: eligible.length - withKit - scratchOnly },
    ],
    firstDayKits: [...kitUsers.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    firstDayKitUsers: withKit,
    slackSetup: cohortPanel(
      cohorts,
      starts,
      ["Day one", "Within week one", "Later", "Not yet"],
      (u) => {
        const at = slackFirst.get(u.sub);
        return at ? lagBucket(elapsedDays(u.firstSeenAt, at)) : 3;
      },
    ),
    checklistCompletion: cohortPanel(
      cohorts,
      starts,
      ["Day one", "Within week one", "Later", "Currently incomplete", "Not started"],
      (u) => {
        const agents = kitAgentsBySub.get(u.sub);
        if (!agents) return null;
        const completed = agents
          .filter((a) => a.onboardedAt)
          .sort((a, b) => a.onboardedAt!.getTime() - b.onboardedAt!.getTime());
        const first = completed[0];
        if (first) return lagBucket(elapsedDays(first.createdAt, first.onboardedAt!));
        return agents.some((a) => a.checklistStarted) ? 3 : 4;
      },
    ),
  };
}

function ordinal(n: number): string {
  return ["1st", "2nd", "3rd", "4th"][n - 1] ?? `${n}th`;
}

function bucketCounts(
  values: number[],
  buckets: Array<{ label: string; max: number }>,
): Share[] {
  const out = buckets.map((b) => ({ label: b.label, count: 0 }));
  for (const v of values) {
    const i = buckets.findIndex((b) => v <= b.max);
    out[i === -1 ? out.length - 1 : i]!.count++;
  }
  return out;
}

function buildAllUse(
  facts: AnalyticsFacts,
  pop: Population,
  today: DayNumber,
): AnalyticsReport["allUse"] {
  const lastStart = lastCompleteWeekStart(today);
  const weeks = weekStartsEndingAt(lastStart, TREND_WEEKS);
  const weekly = weeks.map((m) => windowActivity(pop, { from: m, to: m + 7 }));
  const longWeeks = weekStartsEndingAt(lastStart, LONGITUDINAL_WEEKS);
  const longitudinal = longWeeks.map((m) => longitudinalActivity(pop, m + 7));
  const series = (rows: WindowActivity[]): WeeklySeries[] => [
    { label: "Active", values: rows.map((r) => r.active) },
    { label: "Regular", values: rows.map((r) => r.regular) },
    { label: "Super", values: rows.map((r) => r.super) },
    { label: "Abandoned", values: rows.map((r) => r.abandoned) },
  ];
  const agentsPerWeek = weeks.map((m) => agentsIn(facts, { from: m, to: m + 7 }));

  const agentsByOwner = new Map<string, number>();
  for (const a of facts.agentsCreated) {
    agentsByOwner.set(a.ownerSub, (agentsByOwner.get(a.ownerSub) ?? 0) + 1);
  }

  const featureUsers = new Map<CoreFeature, Set<string>>();
  for (const f of facts.featureFirsts) {
    if (!pop.bySub.has(f.sub)) continue;
    const set = featureUsers.get(f.feature) ?? new Set<string>();
    set.add(f.sub);
    featureUsers.set(f.feature, set);
  }

  const kitCounts = new Map<string, number>();
  const kitUserState = new Map<string, "completed" | "started" | "none">();
  for (const k of facts.kitAgents) {
    kitCounts.set(k.kitId, (kitCounts.get(k.kitId) ?? 0) + 1);
    const prev = kitUserState.get(k.sub) ?? "none";
    const next = k.onboardedAt ? "completed" : k.checklistStarted ? "started" : "none";
    const rank = { none: 0, started: 1, completed: 2 } as const;
    kitUserState.set(k.sub, rank[next] > rank[prev] ? next : prev);
  }
  const states = [...kitUserState.values()];

  return {
    weeks: weeks.map(isoDateOf),
    activity: series(weekly),
    longitudinalWeeks: longWeeks.map(isoDateOf),
    longitudinal: series(longitudinal),
    longitudinalEligible: longitudinal.map((l) => l.eligible),
    agentsCreated: {
      fromKits: agentsPerWeek.map((a) => a.fromKits),
      other: agentsPerWeek.map((a) => a.other),
    },
    agentsPerUser: bucketCounts(
      pop.users.map((u) => agentsByOwner.get(u.sub) ?? 0),
      [
        { label: "0", max: 0 },
        { label: "1", max: 1 },
        { label: "2–3", max: 3 },
        { label: "4–6", max: 6 },
        { label: "7+", max: Infinity },
      ],
    ),
    featureAdoption: CORE_FEATURES.map((f) => ({
      label: FEATURE_LABELS[f],
      count: featureUsers.get(f)?.size ?? 0,
    })).sort((a, b) => b.count - a.count),
    kitPopularity: [...kitCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    checklistState: [
      { label: "Completed", count: states.filter((s) => s === "completed").length },
      { label: "Started, not complete", count: states.filter((s) => s === "started").length },
      { label: "Not started", count: states.filter((s) => s === "none").length },
    ],
  };
}

function sizeOf(agent: LiveAgentFact, slot: AnalyticsFacts["sizing"]["slot"]): SizeRow["size"] {
  if (!agent.cpu && !agent.memory) return "1x";
  const cpu = parseCpuMilli(agent.cpu ?? slot.cpu) / parseCpuMilli(slot.cpu);
  const memory =
    parseMemoryBytes(agent.memory ?? slot.memory) / parseMemoryBytes(slot.memory);
  if (cpu !== memory) return "custom";
  if (cpu === 1) return "1x";
  if (cpu === 2) return "2x";
  if (cpu === 4) return "4x";
  return "custom";
}

function neverHibernates(timeout: string | undefined): boolean {
  return timeout !== undefined && /^[0.hms]+$/.test(timeout) && /0/.test(timeout);
}

function buildAgentsNow(facts: AnalyticsFacts): AnalyticsReport["agentsNow"] {
  const counted = new Set(facts.agentsCreated.map((a) => a.agentId));
  const agents = facts.liveAgents.filter((a) => counted.has(a.id));
  const sizes: SizeRow[] = (["1x", "2x", "4x", "custom"] as const).map((size) => ({
    size,
    agents: 0,
    alwaysOn: 0,
    outOfMemory: 0,
  }));
  for (const a of agents) {
    const row = sizes.find((s) => s.size === sizeOf(a, facts.sizing.slot))!;
    row.agents++;
    if (neverHibernates(a.hibernationTimeout)) row.alwaysOn++;
    if (facts.oomAgentIds.has(a.id)) row.outOfMemory++;
  }
  const gi = 1024 ** 3;
  return {
    total: agents.length,
    sizes,
    disk: bucketCounts(
      agents.map((a) =>
        Math.round(parseMemoryBytes(a.storageSize || facts.sizing.defaultStorage) / gi),
      ),
      [
        { label: "≤ 4 Gi", max: 4 },
        { label: "5 Gi", max: 5 },
        { label: "6–10 Gi", max: 10 },
        { label: "≥ 11 Gi", max: Infinity },
      ],
    ),
    connections: bucketCounts(
      agents.map((a) => a.grantedConnectionIds.length),
      [
        { label: "0", max: 0 },
        { label: "1", max: 1 },
        { label: "2–3", max: 3 },
        { label: "4+", max: Infinity },
      ],
    ),
    knowledgeBases: bucketCounts(
      agents.map(
        (a) =>
          a.grantedConnectionIds.filter((id) => facts.knowledgeBaseConnectionIds.has(id))
            .length,
      ),
      [
        { label: "0", max: 0 },
        { label: "1", max: 1 },
        { label: "2", max: 2 },
        { label: "3+", max: Infinity },
      ],
    ),
  };
}

export const OUT_OF_MEMORY_WINDOW_DAYS = OOM_WINDOW_DAYS;

export function buildAnalyticsReport(
  facts: AnalyticsFacts,
  now: Date,
): AnalyticsReport {
  const today = dayOf(now);
  const pop = population(facts);
  return {
    generatedAt: now.toISOString(),
    today: isoDateOf(today),
    totalUsers: pop.users.length,
    last7: buildLast7(facts, pop, today),
    onboarding: buildOnboarding(facts, pop, today),
    allUse: buildAllUse(facts, pop, today),
    agentsNow: buildAgentsNow(facts),
  };
}

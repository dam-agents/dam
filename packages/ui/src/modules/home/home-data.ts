/**
 * Home page data module.
 *
 * Real endpoints use existing tRPC queries; stubs return fixture data
 * with a `// STUB:` comment naming the endpoint that should replace them.
 */

import { useQuery } from "@tanstack/react-query";

/* ═══════════════════════════════════════════════════════════════════════════
   Real data (re-exports)
   ═══════════════════════════════════════════════════════════════════════════ */

export { useAgentRows } from "../agents/hooks/use-agent-rows.js";
export { usePendingApprovals } from "../approvals/api/queries.js";
export { useArtifacts } from "../artifacts/api/queries.js";
export { useBudgetReserved } from "../budgets/api/queries.js";
export { useDriverSummaries } from "../experiments/api/queries.js";

/* ═══════════════════════════════════════════════════════════════════════════
   Spend per agent (STUB)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AgentSpend {
  agentId: string;
  periodUsd: number;
}

export type SpendPeriod = "today" | "week" | "month" | "year";

export interface SpendOverview {
  totalUsd: number;
  period: SpendPeriod;
  perAgent: AgentSpend[];
}

// STUB: budgets.spendOverview
const SPEND_FIXTURES: Record<SpendPeriod, SpendOverview> = {
  today: {
    totalUsd: 67.12,
    period: "today",
    perAgent: [
      { agentId: "a1b2c3d4-0001-4000-8000-000000000001", periodUsd: 32.5 },
      { agentId: "a1b2c3d4-0005-4000-8000-000000000005", periodUsd: 18.3 },
      { agentId: "a1b2c3d4-0002-4000-8000-000000000002", periodUsd: 9.4 },
      { agentId: "a1b2c3d4-0004-4000-8000-000000000004", periodUsd: 4.1 },
      { agentId: "a1b2c3d4-0006-4000-8000-000000000006", periodUsd: 2.82 },
    ],
  },
  week: {
    totalUsd: 312.45,
    period: "week",
    perAgent: [
      { agentId: "a1b2c3d4-0001-4000-8000-000000000001", periodUsd: 148.9 },
      { agentId: "a1b2c3d4-0005-4000-8000-000000000005", periodUsd: 89.2 },
      { agentId: "a1b2c3d4-0002-4000-8000-000000000002", periodUsd: 42.1 },
      { agentId: "a1b2c3d4-0004-4000-8000-000000000004", periodUsd: 21.6 },
      { agentId: "a1b2c3d4-0006-4000-8000-000000000006", periodUsd: 10.65 },
    ],
  },
  month: {
    totalUsd: 842.37,
    period: "month",
    perAgent: [
      { agentId: "a1b2c3d4-0001-4000-8000-000000000001", periodUsd: 410.2 },
      { agentId: "a1b2c3d4-0005-4000-8000-000000000005", periodUsd: 245.8 },
      { agentId: "a1b2c3d4-0002-4000-8000-000000000002", periodUsd: 112.6 },
      { agentId: "a1b2c3d4-0004-4000-8000-000000000004", periodUsd: 48.3 },
      { agentId: "a1b2c3d4-0006-4000-8000-000000000006", periodUsd: 25.47 },
    ],
  },
  year: {
    totalUsd: 4218.94,
    period: "year",
    perAgent: [
      { agentId: "a1b2c3d4-0001-4000-8000-000000000001", periodUsd: 1890.4 },
      { agentId: "a1b2c3d4-0005-4000-8000-000000000005", periodUsd: 1204.8 },
      { agentId: "a1b2c3d4-0002-4000-8000-000000000002", periodUsd: 612.3 },
      { agentId: "a1b2c3d4-0004-4000-8000-000000000004", periodUsd: 310.5 },
      { agentId: "a1b2c3d4-0006-4000-8000-000000000006", periodUsd: 200.94 },
    ],
  },
};

export function useSpendOverview(period: SpendPeriod = "month") {
  // STUB: budgets.spendOverview
  return useQuery<SpendOverview>({
    queryKey: ["home", "spend-overview", period],
    queryFn: () => Promise.resolve(SPEND_FIXTURES[period]),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Recent scheduled runs (STUB)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ScheduleRun {
  scheduleId: string;
  agentId: string;
  description: string;
  ranAt: string;
  status: "success" | "failed";
  outputSummary: string | null;
}

// STUB: schedules.recentRuns
const now = Date.now();
const SCHEDULE_RUNS_FIXTURE: ScheduleRun[] = [
  {
    scheduleId: "sched-001",
    agentId: "a1b2c3d4-0001-4000-8000-000000000001",
    description: "Daily morning research sync",
    ranAt: new Date(now - 3 * 3_600_000).toISOString(),
    status: "success",
    outputSummary: "Synced 12 new papers, updated 3 summaries",
  },
  {
    scheduleId: "sched-002",
    agentId: "a1b2c3d4-0002-4000-8000-000000000002",
    description: "Nightly test suite",
    ranAt: new Date(now - 8 * 3_600_000).toISOString(),
    status: "failed",
    outputSummary: "3 tests failed in auth module",
  },
];

export function useRecentScheduleRuns() {
  // STUB: schedules.recentRuns
  return useQuery<ScheduleRun[]>({
    queryKey: ["home", "recent-schedule-runs"],
    queryFn: () => Promise.resolve(SCHEDULE_RUNS_FIXTURE),
    staleTime: 60_000,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Knowledge Base activity (STUB)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface KbActivity {
  agentId: string;
  pagesIndexed: number;
  lastIndexedAt: string | null;
}

// STUB: knowledgeBases.activity
const KB_ACTIVITY_FIXTURE: KbActivity[] = [
  {
    agentId: "a1b2c3d4-0004-4000-8000-000000000004",
    pagesIndexed: 3,
    lastIndexedAt: new Date(now - 2 * 3_600_000).toISOString(),
  },
  {
    agentId: "a1b2c3d4-0007-4000-8000-000000000007",
    pagesIndexed: 0,
    lastIndexedAt: null,
  },
  {
    agentId: "a1b2c3d4-0008-4000-8000-000000000008",
    pagesIndexed: 0,
    lastIndexedAt: null,
  },
];

export function useKbActivity() {
  // STUB: knowledgeBases.activity
  return useQuery<KbActivity[]>({
    queryKey: ["home", "kb-activity"],
    queryFn: () => Promise.resolve(KB_ACTIVITY_FIXTURE),
    staleTime: 60_000,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

export function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

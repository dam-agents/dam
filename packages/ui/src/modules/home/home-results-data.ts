/**
 * "Results" — completed experiment/evaluation runs with meaningful outcomes.
 */

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { AGENT_IDS } from "../../mock/data/agents.js";
import { getActiveScenario, subscribeScenario } from "./home-scenarios.js";
import { POLL_INTERVAL_MS, RESULT_SIGNIFICANT_DELTA } from "./home-thresholds.js";

export interface ResultItem {
  id: string;
  agentId: string;
  agentName: string;
  experimentName: string;
  completedAt: string;
  metric: string;
  baseline: number;
  result: number;
  unit: string;
  isSignificant: boolean;
  seenAt: string | null;
}

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

function significant(baseline: number, result: number): boolean {
  if (baseline === 0) return result !== 0;
  return Math.abs((result - baseline) / baseline) >= RESULT_SIGNIFICANT_DELTA;
}

// STUB: home.resultItems — morning return scenario
const RESULTS_FIXTURE: ResultItem[] = [
  {
    id: "res-001",
    agentId: AGENT_IDS.experiment1,
    agentName: "prompt-tuning-sweep",
    experimentName: "GPT-4o vs Claude Sonnet on summarization",
    completedAt: hoursAgo(4),
    metric: "ROUGE-L",
    baseline: 0.72,
    result: 0.81,
    unit: "",
    isSignificant: significant(0.72, 0.81),
    seenAt: null,
  },
  {
    id: "res-002",
    agentId: AGENT_IDS.experiment2,
    agentName: "rag-chunking-eval",
    experimentName: "256 vs 512 token chunks",
    completedAt: hoursAgo(6),
    metric: "Recall@10",
    baseline: 0.68,
    result: 0.73,
    unit: "",
    isSignificant: significant(0.68, 0.73),
    seenAt: null,
  },
  {
    id: "res-003",
    agentId: AGENT_IDS.experiment3,
    agentName: "latency-benchmark",
    experimentName: "Streaming vs batch inference",
    completedAt: hoursAgo(9),
    metric: "P95 latency",
    baseline: 2100,
    result: 340,
    unit: "ms",
    isSignificant: significant(2100, 340),
    seenAt: null,
  },
];

function getResultsFixture(since: number): ResultItem[] {
  const s = getActiveScenario();
  switch (s) {
    case "first-run":
    case "kb-only":
    case "everything-broken":
      return [];
    case "experiments-only":
      return RESULTS_FIXTURE.filter((r) => Date.parse(r.completedAt) >= since);
    case "single-blocked":
    case "all-clear":
      return RESULTS_FIXTURE.slice(0, 1).filter((r) => Date.parse(r.completedAt) >= since);
    case "heavy-load":
    case "morning-return":
    default:
      return RESULTS_FIXTURE.filter((r) => Date.parse(r.completedAt) >= since);
  }
}

export function useResultItems(digestSince: string) {
  const scenario = useSyncExternalStore(subscribeScenario, getActiveScenario, getActiveScenario);
  // STUB: home.resultItems
  return useQuery<ResultItem[]>({
    queryKey: ["home", "result-items", digestSince, scenario],
    queryFn: () => Promise.resolve(getResultsFixture(Date.parse(digestSince))),
    staleTime: POLL_INTERVAL_MS,
    refetchInterval: POLL_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });
}

export function formatDelta(baseline: number, result: number, unit: string): string {
  if (baseline === 0) return `${result}${unit}`;
  const diff = result - baseline;
  const pct = ((diff / baseline) * 100).toFixed(0);
  const sign = diff > 0 ? "+" : "";
  if (unit) {
    return `${result}${unit} (${sign}${pct}%)`;
  }
  return `${result.toFixed(2)} (${sign}${pct}%)`;
}

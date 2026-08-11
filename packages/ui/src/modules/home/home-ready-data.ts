/**
 * "Ready for you" — items agents completed that await user action/review.
 */

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { AGENT_IDS } from "../../mock/data/agents.js";
import { getActiveScenario, subscribeScenario } from "./home-scenarios.js";
import { POLL_INTERVAL_MS } from "./home-thresholds.js";

export type ReadyItemType =
  | "pr_ready"
  | "artifact_ready"
  | "suggestion"
  | "run_complete";

export interface ReadyItem {
  id: string;
  type: ReadyItemType;
  agentId: string;
  agentName: string;
  title: string;
  subtitle: string | null;
  completedAt: string;
  seenAt: string | null;
  actionLabel: string;
  actionUrl: string | null;
}

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

// STUB: home.readyItems — morning return scenario
const READY_FIXTURE: ReadyItem[] = [
  {
    id: "rdy-001",
    type: "pr_ready",
    agentId: AGENT_IDS.claudeCodeMain,
    agentName: "claude-code-main",
    title: "PR #142: Refactor auth middleware",
    subtitle: "3 files changed, all tests passing",
    completedAt: hoursAgo(2),
    seenAt: null,
    actionLabel: "Review PR",
    actionUrl: null,
  },
  {
    id: "rdy-002",
    type: "artifact_ready",
    agentId: AGENT_IDS.codexResearch,
    agentName: "codex-research",
    title: "Weekly research digest",
    subtitle: "12 papers summarized, 3 flagged as high-relevance",
    completedAt: hoursAgo(3),
    seenAt: null,
    actionLabel: "View artifact",
    actionUrl: null,
  },
  {
    id: "rdy-003",
    type: "suggestion",
    agentId: AGENT_IDS.claudeCodeMain,
    agentName: "claude-code-main",
    title: "Suggested: Enable streaming in /api/chat",
    subtitle: "Would reduce TTFB from 2.1s to 340ms based on profiling",
    completedAt: hoursAgo(5),
    seenAt: null,
    actionLabel: "Review",
    actionUrl: null,
  },
  {
    id: "rdy-004",
    type: "run_complete",
    agentId: AGENT_IDS.geminiPipeline,
    agentName: "gemini-data-pipeline",
    title: "Data pipeline refresh completed",
    subtitle: "Processed 2,847 records in 18m",
    completedAt: hoursAgo(7),
    seenAt: null,
    actionLabel: "View output",
    actionUrl: null,
  },
];

function getReadyFixture(since: number): ReadyItem[] {
  const s = getActiveScenario();
  switch (s) {
    case "first-run":
    case "everything-broken":
      return [];
    case "all-clear":
      return READY_FIXTURE.filter((r) => Date.parse(r.completedAt) >= since);
    case "single-blocked":
      return READY_FIXTURE.slice(0, 1).filter((r) => Date.parse(r.completedAt) >= since);
    case "experiments-only":
      return [];
    case "kb-only":
      return [];
    case "heavy-load":
    case "morning-return":
    default:
      return READY_FIXTURE.filter((r) => Date.parse(r.completedAt) >= since);
  }
}

export function useReadyItems(digestSince: string) {
  const scenario = useSyncExternalStore(subscribeScenario, getActiveScenario, getActiveScenario);
  // STUB: home.readyItems
  return useQuery<ReadyItem[]>({
    queryKey: ["home", "ready-items", digestSince, scenario],
    queryFn: () => Promise.resolve(getReadyFixture(Date.parse(digestSince))),
    staleTime: POLL_INTERVAL_MS,
    refetchInterval: POLL_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });
}

/**
 * "Running now" — agents currently executing work.
 */

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { AGENT_IDS } from "../../mock/data/agents.js";
import { getActiveScenario, subscribeScenario } from "./home-scenarios.js";
import { POLL_INTERVAL_MS } from "./home-thresholds.js";

interface RunningBase {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: string;
}

export interface RunningSandbox extends RunningBase {
  kind: "sandbox";
  task: string;
  harness: string;
  provider: string;
}

export interface RunningExperiment extends RunningBase {
  kind: "experiment";
  experimentName: string;
  runLabel: string;
  totalRuns: number;
  completedRuns: number;
  runningInvocations: number;
  status: "running" | "evaluating";
}

export interface RunningKnowledgeBase extends RunningBase {
  kind: "knowledge-base";
  task: string;
  templateName: string;
  connectionCount: number;
  documentsIndexed: number;
}

export type RunningItem = RunningSandbox | RunningExperiment | RunningKnowledgeBase;

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

const RUNNING_FIXTURE: RunningItem[] = [
  {
    id: "run-001",
    agentId: AGENT_IDS.codexResearch,
    agentName: "codex-research",
    task: "Running daily morning research sync",
    startedAt: minsAgo(12),
    kind: "sandbox",
    harness: "Codex",
    provider: "OpenAI",
  },
  {
    id: "run-002",
    agentId: AGENT_IDS.claudeCodeMain,
    agentName: "claude-code-main",
    task: "Executing nightly release prep",
    startedAt: minsAgo(4),
    kind: "sandbox",
    harness: "Claude Code",
    provider: "Anthropic",
  },
  {
    id: "run-003",
    agentId: AGENT_IDS.experiment1,
    agentName: "prompt-tuning-sweep",
    experimentName: "CoT vs Direct prompting",
    runLabel: "Run 14 — Claude Sonnet w/ CoT",
    totalRuns: 20,
    completedRuns: 13,
    runningInvocations: 3,
    status: "running",
    startedAt: minsAgo(45),
    kind: "experiment",
  },
  {
    id: "run-004",
    agentId: AGENT_IDS.knowledgeBase,
    agentName: "product-docs",
    task: "Indexing 3 new pages from Stripe docs",
    startedAt: minsAgo(2),
    kind: "knowledge-base",
    templateName: "LLM Wiki",
    connectionCount: 4,
    documentsIndexed: 847,
  },
];

function getRunningFixture(): RunningItem[] {
  const s = getActiveScenario();
  switch (s) {
    case "first-run":
    case "everything-broken":
      return [];
    case "all-clear":
      return RUNNING_FIXTURE.slice(0, 2);
    case "single-blocked":
      return RUNNING_FIXTURE.slice(0, 1);
    case "experiments-only":
      return RUNNING_FIXTURE.filter((r) => r.kind === "experiment");
    case "kb-only":
      return RUNNING_FIXTURE.filter((r) => r.kind === "knowledge-base");
    case "heavy-load":
    case "morning-return":
    default:
      return RUNNING_FIXTURE;
  }
}

export function useRunningItems() {
  const scenario = useSyncExternalStore(subscribeScenario, getActiveScenario, getActiveScenario);
  return useQuery<RunningItem[]>({
    queryKey: ["home", "running-items", scenario],
    queryFn: () => Promise.resolve(getRunningFixture()),
    staleTime: POLL_INTERVAL_MS,
    refetchInterval: POLL_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });
}

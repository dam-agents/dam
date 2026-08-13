/**
 * "Running now" — agents currently executing work.
 */

import { useQuery } from "@tanstack/react-query";

import { AGENT_IDS } from "../../mock/data/agents.js";
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

export type RunningItem =
  | RunningSandbox
  | RunningExperiment
  | RunningKnowledgeBase;

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

const RUNNING_FIXTURE: RunningItem[] = [
  {
    id: "run-001",
    agentId: AGENT_IDS.codexResearch,
    agentName: "brand-asset-generator",
    task: "Creating Instagram carousel templates for spring campaign",
    startedAt: minsAgo(12),
    kind: "sandbox",
    harness: "Codex",
    provider: "OpenAI",
  },
  {
    id: "run-002",
    agentId: AGENT_IDS.claudeCodeMain,
    agentName: "packaging-layouts",
    task: "Generating print-ready dielines for product boxes",
    startedAt: minsAgo(4),
    kind: "sandbox",
    harness: "Claude Code",
    provider: "Anthropic",
  },
  {
    id: "run-003",
    agentId: AGENT_IDS.experiment1,
    agentName: "color-palette-testing",
    experimentName: "Spring palette — warm vs cool tones",
    runLabel: "Variant 14 — Terracotta + Sage",
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
    agentName: "brand-guidelines",
    task: "Indexing updated logo usage rules and color specs",
    startedAt: minsAgo(2),
    kind: "knowledge-base",
    templateName: "Brand Wiki",
    connectionCount: 4,
    documentsIndexed: 847,
  },
];

function getRunningFixture(): RunningItem[] {
  return RUNNING_FIXTURE;
}

export function useRunningItems() {
  return useQuery<RunningItem[]>({
    queryKey: ["home", "running-items"],
    queryFn: () => Promise.resolve(getRunningFixture()),
    staleTime: POLL_INTERVAL_MS,
    refetchInterval: POLL_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });
}

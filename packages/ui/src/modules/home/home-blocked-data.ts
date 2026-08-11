import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { AGENT_IDS } from "../../mock/data/agents.js";
import { getActiveScenario, subscribeScenario } from "./home-scenarios.js";

export type BlockedItemType =
  | "approval"
  | "run_failure"
  | "connection_error"
  | "agent_error";

export interface BlockedItem {
  id: string;
  type: BlockedItemType;
  agentId: string;
  agentName: string;
  runId: string | null;
  runName: string | null;
  blockedAt: string; // ISO8601 — when it stopped
  intent: string;
  detail: { primary: string; secondary?: string };
  seenAt: string | null;
  holdsComputeSlot: boolean;
  // approval only:
  requestKind?: "network" | "tool";
  host?: string;
  toolName?: string;
  toolArgs?: unknown;
  // run_failure only:
  ranForMs?: number;
}

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

// STUB: home.blockedItems — morning return scenario (default)
const BLOCKED_FIXTURE: BlockedItem[] = [
  // Tier A: approval, blocked 11h 40m (critical — overnight)
  {
    id: "blk-001",
    type: "approval",
    agentId: AGENT_IDS.codexResearch,
    agentName: "codex-research",
    runId: "run-morning-sync",
    runName: "Daily morning research sync",
    blockedAt: hoursAgo(11.67),
    intent: 'Reading repo contents during "Daily morning research sync"',
    detail: {
      primary: "GET api.github.com",
      secondary: "/repos/acme-org/my-repo/contents/README.md",
    },
    seenAt: null,
    holdsComputeSlot: true,
    requestKind: "network",
    host: "api.github.com",
  },
  // Tier A: approval, blocked 4m (normal)
  {
    id: "blk-002",
    type: "approval",
    agentId: AGENT_IDS.claudeCodeMain,
    agentName: "claude-code-main",
    runId: "run-nightly-release",
    runName: "Nightly release prep",
    blockedAt: minsAgo(4),
    intent: 'Publishing package during "Nightly release prep"',
    detail: {
      primary: "POST registry.npmjs.org",
      secondary: "/v2/@acme/shared-lib",
    },
    seenAt: null,
    holdsComputeSlot: true,
    requestKind: "network",
    host: "registry.npmjs.org",
  },
  // Tier B: run_failure, blocked 8h
  {
    id: "blk-004",
    type: "run_failure",
    agentId: AGENT_IDS.claudeCodeMain,
    agentName: "claude-code-main",
    runId: "run-nightly-tests",
    runName: "Nightly test suite",
    blockedAt: hoursAgo(8),
    intent: '"Nightly test suite" failed after 42m',
    detail: {
      primary: "3 tests failed in auth module",
      secondary:
        "FAIL src/auth/session.test.ts — Expected token refresh to succeed",
    },
    seenAt: null,
    holdsComputeSlot: false,
    ranForMs: 42 * 60 * 1000,
  },
  // Tier B: connection_error, blocked 6h
  {
    id: "blk-005",
    type: "connection_error",
    agentId: AGENT_IDS.knowledgeBase3,
    agentName: "incident-postmortems",
    runId: null,
    runName: null,
    blockedAt: hoursAgo(6),
    intent: "incident-postmortems can't be reached — SSH key expired",
    detail: {
      primary: "git-clone: Failed to clone: SSH key expired",
      secondary: "Last successful sync 2d ago",
    },
    seenAt: null,
    holdsComputeSlot: false,
  },
  // Tier B: agent_error, blocked 3h
  {
    id: "blk-006",
    type: "agent_error",
    agentId: AGENT_IDS.geminiPipeline,
    agentName: "gemini-data-pipeline",
    runId: "run-data-pipeline",
    runName: "Data pipeline refresh",
    blockedAt: hoursAgo(3),
    intent: 'gemini-data-pipeline stopped unexpectedly during "Data pipeline refresh"',
    detail: {
      primary: "Container exited with code 137 (OOMKilled)",
      secondary: "Exceeded 512Mi memory limit",
    },
    seenAt: null,
    holdsComputeSlot: false,
  },
];

function getBlockedFixture(): BlockedItem[] {
  const s = getActiveScenario();
  switch (s) {
    case "all-clear":
    case "first-run":
    case "experiments-only":
    case "kb-only":
      return [];
    case "single-blocked":
      return [BLOCKED_FIXTURE[0]!];
    case "everything-broken":
      return BLOCKED_FIXTURE;
    case "heavy-load":
      return BLOCKED_FIXTURE.slice(0, 3);
    case "morning-return":
    default:
      return BLOCKED_FIXTURE;
  }
}

// STUB: home.blockedItems
export function useBlockedItems() {
  const scenario = useSyncExternalStore(subscribeScenario, getActiveScenario, getActiveScenario);
  return useQuery<BlockedItem[]>({
    queryKey: ["home", "blocked-items", scenario],
    queryFn: () => Promise.resolve(getBlockedFixture()),
    staleTime: 30_000,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * Rank blocked items per §3: Tier A (holds compute slot) above Tier B,
 * sorted by blockedAt ascending (longest-blocked first) within each tier.
 * Tie-break: agent name alphabetical.
 */
export function rankBlockedItems(items: BlockedItem[]): BlockedItem[] {
  return [...items].sort((a, b) => {
    // Tier A (holdsComputeSlot) above Tier B
    if (a.holdsComputeSlot !== b.holdsComputeSlot) {
      return a.holdsComputeSlot ? -1 : 1;
    }
    // Within tier: oldest first (longest blocked)
    const aTime = Date.parse(a.blockedAt);
    const bTime = Date.parse(b.blockedAt);
    if (aTime !== bTime) return aTime - bTime;
    // Tie-break: alphabetical
    return a.agentName.localeCompare(b.agentName);
  });
}

/**
 * "Learnings" — new knowledge/insights surfaced by knowledge-base agents.
 */

import { useQuery } from "@tanstack/react-query";

import { AGENT_IDS } from "../../mock/data/agents.js";
import { POLL_INTERVAL_MS } from "./home-thresholds.js";

export interface LearningItem {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  summary: string;
  sourceCount: number;
  indexedAt: string;
  seenAt: string | null;
}

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

// STUB: home.learningItems — morning return scenario
const LEARNINGS_FIXTURE: LearningItem[] = [
  {
    id: "lrn-001",
    agentId: AGENT_IDS.knowledgeBase,
    agentName: "product-docs",
    title: "3 new API deprecation notices",
    summary:
      "Stripe API v2023-10 deprecated three endpoints we use in billing.ts. Migration guide available.",
    sourceCount: 3,
    indexedAt: hoursAgo(2),
    seenAt: null,
  },
  {
    id: "lrn-002",
    agentId: AGENT_IDS.knowledgeBase3,
    agentName: "incident-postmortems",
    title: "New postmortem: Redis cluster failover",
    summary:
      "Production Redis cluster failed over at 02:14 UTC. Root cause: memory fragmentation exceeding 80% threshold. Auto-remediation fired but was delayed by 4m.",
    sourceCount: 1,
    indexedAt: hoursAgo(5),
    seenAt: null,
  },
  {
    id: "lrn-003",
    agentId: AGENT_IDS.knowledgeBase2,
    agentName: "competitor-intel",
    title: "Competitor launched new pricing tier",
    summary:
      'Competitor X announced a "Teams" plan at $49/seat, undercutting our starter tier by 30%.',
    sourceCount: 2,
    indexedAt: hoursAgo(8),
    seenAt: null,
  },
];

function getLearningsFixture(): LearningItem[] {
  return LEARNINGS_FIXTURE;
}

export function useLearningItems(digestSince: string) {
  // STUB: home.learningItems
  return useQuery<LearningItem[]>({
    queryKey: ["home", "learning-items", digestSince],
    queryFn: () => Promise.resolve(getLearningsFixture()),
    staleTime: POLL_INTERVAL_MS,
    refetchInterval: POLL_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });
}

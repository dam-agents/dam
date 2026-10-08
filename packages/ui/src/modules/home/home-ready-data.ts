/**
 * "Ready for you" — items agents completed that await user action/review.
 */

import { useQuery } from "@tanstack/react-query";

import { AGENT_IDS } from "../../mock/data/agents.js";
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
    agentName: "packaging-layouts",
    title: "Product box dielines — ready for print review",
    subtitle: "6 packaging variants exported as press-ready PDFs",
    completedAt: hoursAgo(2),
    seenAt: null,
    actionLabel: "Review files",
    actionUrl: null,
  },
  {
    id: "rdy-002",
    type: "artifact_ready",
    agentId: AGENT_IDS.codexResearch,
    agentName: "brand-asset-generator",
    title: "Social media templates — Spring 2025",
    subtitle: "24 Instagram + 12 LinkedIn templates in brand colors",
    completedAt: hoursAgo(3),
    seenAt: null,
    actionLabel: "View assets",
    actionUrl: null,
  },
  {
    id: "rdy-003",
    type: "suggestion",
    agentId: AGENT_IDS.codexResearch,
    agentName: "brand-asset-generator",
    title: "Suggestion: Try the secondary palette for CTAs",
    subtitle:
      "Warm coral (#E8735A) tested 23% higher click-through on dark backgrounds",
    completedAt: hoursAgo(5),
    seenAt: null,
    actionLabel: "Review",
    actionUrl: null,
  },
  {
    id: "rdy-004",
    type: "run_complete",
    agentId: AGENT_IDS.geminiPipeline,
    agentName: "photo-retouching",
    title: "Product photo batch — retouching complete",
    subtitle:
      "48 images processed: background removal, color grading, resize to 3 formats",
    completedAt: hoursAgo(7),
    seenAt: null,
    actionLabel: "View photos",
    actionUrl: null,
  },
];

function getReadyFixture(): ReadyItem[] {
  return READY_FIXTURE;
}

export function useReadyItems(digestSince: string) {
  // STUB: home.readyItems
  return useQuery<ReadyItem[]>({
    queryKey: ["home", "ready-items", digestSince],
    queryFn: () => Promise.resolve(getReadyFixture()),
    staleTime: POLL_INTERVAL_MS,
    refetchInterval: POLL_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });
}

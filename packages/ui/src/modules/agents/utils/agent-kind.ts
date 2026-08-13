import type { AgentKind } from "api-server-api";

import type { AgentView } from "../../../types.js";

export function isKnowledgeBase(agent: AgentView): boolean {
  return agent.kind === "knowledge-base";
}

export function isExperimentSandbox(agent: AgentView): boolean {
  return agent.kind === "experiment";
}

export interface AgentKindBadge {
  label: string;
  variant: "accent" | "template" | "muted";
}

const KIND_BADGE: Record<AgentKind, AgentKindBadge> = {
  experiment: { label: "Experiment", variant: "accent" },
  "knowledge-base": { label: "Knowledge base", variant: "template" },
};

export function agentKindBadge(agent: AgentView): AgentKindBadge | null {
  if (!agent.kind) return null;
  return KIND_BADGE[agent.kind] ?? { label: agent.kind, variant: "muted" };
}

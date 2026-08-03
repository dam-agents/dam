import type { AgentKind } from "api-server-api";

import type { AgentView } from "../../../types.js";

/** The single place the kind literal is compared. */
export function isKnowledgeBase(agent: AgentView): boolean {
  return agent.kind === "knowledge-base";
}

/** Declared intent only — any agent that registers a plan drives experiments,
 *  so this is not the test for "belongs on the Experiments destination". */
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

/** Null on a plain sandbox. An unknown kind (a newer writer) reads as-is in a
 *  neutral pill rather than vanishing. */
export function agentKindBadge(agent: AgentView): AgentKindBadge | null {
  if (!agent.kind) return null;
  return KIND_BADGE[agent.kind] ?? { label: agent.kind, variant: "muted" };
}

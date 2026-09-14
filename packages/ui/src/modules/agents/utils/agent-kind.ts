import type { AgentKind } from "api-server-api";

import type { AgentView } from "../../../types.js";

export function isKnowledgeBase(agent: AgentView): boolean {
  return agent.kind === "knowledge-base";
}

export function isExperimentSandbox(agent: AgentView): boolean {
  return agent.kind === "experiment";
}

export function isCodingAgent(agent: AgentView): boolean {
  return !agent.kind;
}

export function isStarterKitAgent(agent: AgentView): boolean {
  return agent.starterKit !== null;
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

export function starterKitBadge(
  agent: Pick<AgentView, "starterKit">,
): (AgentKindBadge & { title: string }) | null {
  if (!agent.starterKit) return null;
  const at = agent.starterKit.lastIndexOf("@");
  const path = at > 0 ? agent.starterKit.slice(0, at) : agent.starterKit;
  const kit = path.slice(path.indexOf("/") + 1);
  return { label: `Kit: ${kit}`, variant: "muted", title: agent.starterKit };
}

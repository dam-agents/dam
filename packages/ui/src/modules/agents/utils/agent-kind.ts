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
  variant: "accent" | "template" | "muted" | "warning" | "kit";
}

const KIND_BADGE: Record<AgentKind, AgentKindBadge> = {
  experiment: { label: "Experiment", variant: "accent" },
  "knowledge-base": { label: "Knowledge base", variant: "template" },
};

export function agentKindBadge(agent: AgentView): AgentKindBadge | null {
  if (!agent.kind) return null;
  return KIND_BADGE[agent.kind] ?? { label: agent.kind, variant: "muted" };
}

export function parseStarterKitRef(
  ref: string,
): { catalog: string; kit: string; version: string | null } | null {
  const at = ref.lastIndexOf("@");
  const path = at > 0 ? ref.slice(0, at) : ref;
  const slash = path.indexOf("/");
  if (slash <= 0 || slash === path.length - 1) return null;
  return {
    catalog: path.slice(0, slash),
    kit: path.slice(slash + 1),
    version: at > 0 ? ref.slice(at + 1) : null,
  };
}

export function starterKitBadge(
  agent: Pick<AgentView, "starterKit">,
): (AgentKindBadge & { title: string }) | null {
  if (!agent.starterKit) return null;
  const ref = parseStarterKitRef(agent.starterKit);
  return {
    label: ref?.kit ?? agent.starterKit,
    variant: "muted",
    title: agent.starterKit,
  };
}

export function onboardingBadge(
  agent: Pick<AgentView, "starterKit" | "starterKitOnboarded">,
): (AgentKindBadge & { title: string }) | null {
  if (!agent.starterKit || agent.starterKitOnboarded) return null;
  return {
    label: "Onboarding",
    variant: "kit",
    title:
      "Still being set up. Its schedules are held until the agent marks onboarding complete.",
  };
}

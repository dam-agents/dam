import type { AgentKind } from "api-server-api";

import type { AgentView } from "../../../types.js";

export function sharesKnowledgeBase(agent: AgentView): boolean {
  if (agent.kbShareRoots && agent.kbShareRoots.length > 0) return true;
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

const KIND_BADGE: Record<AgentKind, AgentKindBadge | null> = {
  experiment: { label: "Experiment", variant: "accent" },
  "knowledge-base": null,
};

export function agentKindBadge(agent: AgentView): AgentKindBadge | null {
  if (!agent.kind) return null;
  if (agent.kind in KIND_BADGE) return KIND_BADGE[agent.kind];
  return { label: agent.kind, variant: "muted" };
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
  agent: Pick<AgentView, "starterKit" | "kbTemplateId">,
): (AgentKindBadge & { title: string }) | null {
  if (!agent.starterKit) {
    if (!agent.kbTemplateId) return null;
    return {
      label: agent.kbTemplateId,
      variant: "muted",
      title: `platform/${agent.kbTemplateId}`,
    };
  }
  const ref = parseStarterKitRef(agent.starterKit);
  return {
    label: ref?.kit ?? agent.starterKit,
    variant: "muted",
    title: agent.starterKit,
  };
}

export function knowledgeBadge(
  agent: AgentView,
): (AgentKindBadge & { title: string }) | null {
  if (!sharesKnowledgeBase(agent)) return null;
  return {
    label: "Knowledge",
    variant: "template",
    title: "Publishes a knowledge base that can be shared read-only",
  };
}

export function onboardingProgress(
  steps: readonly { done: boolean }[] | undefined,
): { done: number; total: number } | null {
  if (!steps || steps.length === 0) return null;
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

export function onboardingBadge(
  agent: Pick<
    AgentView,
    "starterKit" | "starterKitOnboarded" | "onboardingSteps"
  >,
): (AgentKindBadge & { title: string }) | null {
  if (!agent.starterKit || agent.starterKitOnboarded) return null;
  const progress = onboardingProgress(agent.onboardingSteps);
  return {
    label: progress
      ? `Onboarding ${progress.done}/${progress.total}`
      : "Onboarding",
    variant: "kit",
    title:
      "Still being set up. Any schedules on it are held until the agent marks onboarding complete.",
  };
}

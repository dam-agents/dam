import type { AgentView } from "../../../types.js";

interface AgentKindBadge {
  label: string;
  variant: "accent" | "template" | "muted" | "warning" | "kit";
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

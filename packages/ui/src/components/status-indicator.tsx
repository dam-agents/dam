import { Badge, type BadgeProps } from "@/components/ui/badge";

import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver.js";

export const stateLabel: Record<AgentDisplayState, string> = {
  running: "Working",
  running_always_on: "Working",
  starting: "Working",
  preparing_workspace: "Working",
  hibernating: "Hibernating",
  hibernated: "Idle",
  idle_always_on: "Idle",
  error: "Error",
  over_budget: "Over budget",
};

const stateVariant: Record<
  AgentDisplayState,
  NonNullable<BadgeProps["variant"]>
> = {
  running: "success",
  running_always_on: "success",
  starting: "success",
  preparing_workspace: "success",
  hibernating: "muted",
  hibernated: "info",
  idle_always_on: "info",
  error: "danger",
  over_budget: "warning",
};

export const stateDotClass: Record<AgentDisplayState, string> = {
  running: "bg-green-700 dark:bg-success",
  running_always_on: "bg-green-700 dark:bg-success",
  starting: "bg-green-700 dark:bg-success",
  preparing_workspace: "bg-green-700 dark:bg-success",
  hibernating: "bg-[#878d96] dark:bg-[#a8a29e]",
  hibernated: "bg-[#4589ff] dark:bg-[#60a5fa]",
  idle_always_on: "bg-[#4589ff] dark:bg-[#60a5fa]",
  error: "bg-danger",
  over_budget: "bg-warning-fg",
};

export function StatusBadge({ state }: { state: AgentDisplayState }) {
  return <Badge variant={stateVariant[state]}>{stateLabel[state]}</Badge>;
}
